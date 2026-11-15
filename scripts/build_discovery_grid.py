#!/usr/bin/env python3
"""
Builds compact 1.0 deg global land screening grid (src/data/global_discovery_grid.json, STRICTLY < 2 MB).
Data sources:
  1. AWS Mapzen Terrarium z=3 global elevation & slope grid (64 PNG tiles)
  2. NASA POWER AWS Open Data S3 Zarr global 12-month climatology (T2M, PRECTOTCORR, CLOUD_AMT)
     decoded via Node's native zlib.zstdDecompressSync (0 rate limits, < 10 seconds total)
  3. Classic analog 200 km Haversine exclusion mask + WHYMAP WOKAM karst & volcanic lava-tube provinces
"""

import concurrent.futures
import json
import math
import struct
import subprocess
import time
import urllib.request
import zlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
OVERRIDES_PATH = ROOT / "scripts" / "raw_literature_overrides.json"
GRID_OUT = ROOT / "src" / "data" / "global_discovery_grid.json"
USER_AGENT = "WeywotEngine-GridBuilder/1.0"

LAVA_TUBE_PROVINCES = [
    (18.8, 20.3, -156.2, -154.7, "Hawaii"),
    (63.4, 66.6, -24.5, -13.5, "Iceland"),
    (-19.0, -17.3, 143.8, 145.6, "Undara Queensland"),
    (22.5, 26.5, 38.5, 42.0, "Harrat Khaybar / Rahat Arabia"),
    (27.5, 29.5, -18.2, -13.4, "Canary Islands"),
    (37.5, 38.2, 14.7, 15.3, "Mt Etna Sicily"),
    (33.1, 33.6, 126.1, 127.0, "Jeju Island"),
    (41.2, 44.5, -122.2, -112.5, "Modoc / Snake River Plain"),
    (34.5, 35.6, -108.5, -107.2, "El Malpais NM"),
    (-0.5, 3.0, 36.0, 38.8, "Kenya Rift"),
    (3.0, 9.5, 38.0, 42.5, "Ethiopian Rift"),
    (-38.5, -37.2, 141.5, 144.0, "Newer Volcanics Victoria"),
    (35.0, 35.6, 138.4, 139.2, "Mt Fuji"),
]

KARST_CAVE_PROVINCES = [
    (33.0, 34.7, 35.1, 36.5, "Mount Lebanon / Anti-Lebanon Karst"),
    (42.5, 46.2, 13.5, 19.5, "Dinaric Alps Karst"),
    (22.5, 26.5, 103.5, 111.5, "South China Karst"),
    (18.5, 21.6, -90.5, -86.8, "Yucatan Cenote Karst"),
    (-32.2, -30.5, 125.0, 131.0, "Nullarbor Plain Karst"),
    (28.0, 33.5, 47.0, 54.0, "Zagros Karst"),
    (22.0, 24.5, 56.5, 59.5, "Al Hajar Oman Karst"),
    (-19.5, -17.5, 44.2, 45.2, "Tsingy Madagascar"),
    (31.5, 32.8, -105.0, -103.8, "Guadalupe / Carlsbad"),
    (36.5, 38.2, -87.0, -85.0, "Mammoth Cave Plateau"),
    (21.5, 23.0, -84.2, -82.5, "Vinales Cuba Karst"),
    (36.5, 38.0, 29.0, 33.0, "Taurus Mountains Karst"),
]

NODE_ZARR_FETCHER = r"""
const zlib = require('zlib');
const fs = require('fs');

function decodeBloscZstd(buf) {
  const flags = buf[2], typesize = buf[3];
  const nbytes = buf.readUInt32LE(4), blocksize = buf.readUInt32LE(8);
  const nblocks = Math.ceil(nbytes / blocksize);
  const out = Buffer.alloc(nbytes);
  let outOff = 0;
  for (let b = 0; b < nblocks; b++) {
    let pos = buf.readUInt32LE(16 + b * 4);
    const expected = Math.min(blocksize, nbytes - outOff);
    const cs0 = buf.readUInt32LE(pos);
    let rawB;
    const nextOff = (b + 1 < nblocks) ? buf.readUInt32LE(16 + (b + 1) * 4) : buf.length;
    if (pos + 4 + cs0 === nextOff && buf.readUInt32LE(pos + 4) === 0xfd2fb528) {
      rawB = zlib.zstdDecompressSync(buf.subarray(pos + 4, pos + 4 + cs0));
    } else if (cs0 === expected && pos + 4 + cs0 === nextOff) {
      rawB = buf.subarray(pos + 4, pos + 4 + cs0);
    } else {
      const parts = [];
      const partExp = expected / typesize;
      for (let t = 0; t < typesize; t++) {
        const cs = buf.readUInt32LE(pos);
        pos += 4;
        if (cs === partExp && (pos + 4 > buf.length || buf.readUInt32LE(pos) !== 0xfd2fb528)) {
          parts.push(buf.subarray(pos, pos + cs));
        } else {
          parts.push(zlib.zstdDecompressSync(buf.subarray(pos, pos + cs)));
        }
        pos += cs;
      }
      rawB = Buffer.concat(parts);
    }
    const nitems = rawB.length / typesize;
    if (flags & 4) {
      const nitems8 = Math.floor(nitems / 8) * 8;
      const totalBits = typesize * 8;
      const bytesPerPlane = nitems8 / 8;
      for (let k = 0; k < totalBits; k++) {
        const byteInElem = k >> 3;
        const bitInByte = k & 7;
        const planeOff = k * bytesPerPlane;
        for (let i = 0; i < nitems8; i++) {
          if ((rawB[planeOff + (i >> 3)] >> (i & 7)) & 1) {
            out[outOff + i * typesize + byteInElem] |= (1 << bitInByte);
          }
        }
      }
      rawB.copy(out, outOff + nitems8 * typesize, nitems8 * typesize);
    } else if (flags & 1) {
      for (let i = 0; i < nitems; i++) {
        for (let t = 0; t < typesize; t++) {
          out[outOff + i * typesize + t] = rawB[t * nitems + i];
        }
      }
    } else {
      rawB.copy(out, outOff);
    }
    outOff += rawB.length;
  }
  return new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
}

async function fetchVar(baseUrl, nLat, nLon) {
  const months = [];
  await Promise.all(Array.from({ length: 12 }, async (_, m) => {
    const r = await fetch(`${baseUrl}/${m}.0.0`);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${baseUrl}/${m}.0.0`);
    const buf = Buffer.from(await r.arrayBuffer());
    const floats = decodeBloscZstd(buf);
    const decoded = new Float32Array(floats.length);
    for (let i = 0; i < floats.length; i++) {
      decoded[i] = floats[i] / 100.0 + 1000.0;
    }
    months[m] = decoded;
  }));
  return months;
}

async function main() {
  const [t2m, prec, cld] = await Promise.all([
    fetchVar('https://nasa-power.s3.amazonaws.com/merra2/spatial/power_merra2_climatology_spatial_utc.zarr/T2M', 361, 576),
    fetchVar('https://nasa-power.s3.amazonaws.com/merra2/spatial/power_merra2_climatology_spatial_utc.zarr/PRECTOTCORR', 361, 576),
    fetchVar('https://nasa-power.s3.amazonaws.com/syn1deg/spatial/power_syn1deg_climatology_spatial_utc.zarr/CLOUD_AMT', 180, 360),
  ]);

  const coords = JSON.parse(fs.readFileSync(0, 'utf8'));
  const quarterMonths = [[11, 0, 1], [2, 3, 4], [5, 6, 7], [8, 9, 10]];
  const out = coords.map(([lat, lon]) => {
    const mLatIdx = Math.max(0, Math.min(360, Math.round((lat + 90.0) / 0.5)));
    const mLonIdx = Math.max(0, Math.min(575, Math.round((lon + 180.0) / 0.625)));
    const mIdx = mLatIdx * 576 + mLonIdx;

    const sLatIdx = Math.max(0, Math.min(179, Math.round(lat + 89.5)));
    const sLonIdx = Math.max(0, Math.min(359, Math.round(lon + 179.5)));
    const sIdx = sLatIdx * 360 + sLonIdx;

    const qT = [], qP = [], qC = [];
    for (const qm of quarterMonths) {
      let sT = 0, sP = 0, sC = 0;
      for (const m of qm) {
        sT += t2m[m][mIdx];
        sP += prec[m][mIdx];
        sC += cld[m][sIdx];
      }
      qT.push(sT / 3.0);
      qP.push(sP / 3.0);
      qC.push(sC / 3.0);
    }
    return [qT, qP, qC];
  });
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => { console.error(e); process.exit(1); });
"""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def decode_png_rgb(png_bytes: bytes) -> Tuple[int, int, List[List[Tuple[int, int, int]]]]:
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG")
    pos = 8
    width = height = bit_depth = color_type = 0
    idat: List[bytes] = []
    while pos < len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
        ctype = png_bytes[pos + 4 : pos + 8]
        data = png_bytes[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", data)
        elif ctype == b"IDAT":
            idat.append(data)
        elif ctype == b"IEND":
            break
    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat))

    def paeth(a: int, b: int, c: int) -> int:
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    prev = bytearray(stride)
    pixels: List[List[Tuple[int, int, int]]] = []
    idx = 0
    for _ in range(height):
        ftype = raw[idx]
        idx += 1
        scan = raw[idx : idx + stride]
        idx += stride
        recon = bytearray(stride)
        for i in range(stride):
            x = scan[i]
            a = recon[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if ftype == 0:
                recon[i] = x
            elif ftype == 1:
                recon[i] = (x + a) & 0xFF
            elif ftype == 2:
                recon[i] = (x + b) & 0xFF
            elif ftype == 3:
                recon[i] = (x + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                recon[i] = (x + paeth(a, b, c)) & 0xFF
        prev = recon
        pixels.append([(recon[c * bpp], recon[c * bpp + 1], recon[c * bpp + 2]) for c in range(width)])
    return width, height, pixels


def fetch_terrarium_z3_global() -> List[List[float]]:
    z = 3
    n = 8
    grid = [[0.0] * (n * 256) for _ in range(n * 256)]

    def fetch_tile(tx: int, ty: int) -> Tuple[int, int, List[List[Tuple[int, int, int]]]]:
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            _, _, rgb = decode_png_rgb(resp.read())
        return tx, ty, rgb

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(fetch_tile, tx, ty) for tx in range(n) for ty in range(n)]
        for fut in concurrent.futures.as_completed(futs):
            tx, ty, rgb = fut.result()
            y_off = ty * 256
            x_off = tx * 256
            for r in range(256):
                row_rgb = rgb[r]
                row_out = grid[y_off + r]
                for c in range(256):
                    red, green, blue = row_rgb[c]
                    row_out[x_off + c] = (red * 256.0 + green + blue / 256.0) - 32768.0
    return grid


def sample_elev_slope_z3(grid: List[List[float]], lat: float, lon: float) -> Tuple[float, float]:
    lat_c = max(-84.5, min(84.5, lat))
    size = 2048
    x_f = ((lon + 180.0) / 360.0) * size
    lat_r = math.radians(lat_c)
    y_f = ((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0) * size
    px = max(1, min(size - 2, int(x_f)))
    py = max(1, min(size - 2, int(y_f)))
    elev = grid[py][px]
    res_m = max(1000.0, (156543.03392 * math.cos(lat_r)) / 8.0)
    dz_dx = (grid[py][px + 1] - grid[py][px - 1]) / (2.0 * res_m)
    dz_dy = (grid[py + 1][px] - grid[py - 1][px]) / (2.0 * res_m)
    macro_slope = math.degrees(math.atan(math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy))) * 4.5
    return elev, min(42.0, macro_slope)


def in_province(lat: float, lon: float, boxes: List[Tuple[float, float, float, float, str]]) -> bool:
    for la0, la1, lo0, lo1, _ in boxes:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return True
    return False


def main() -> None:
    t0 = time.time()
    with open(OVERRIDES_PATH, "r", encoding="utf-8") as f:
        overrides = json.load(f)

    classic_hubs = [(s["lat"], s["lon"]) for s in overrides["earthSites"] if s.get("isClassicRegion")]

    print("1/3 Fetching AWS Terrarium z=3 global elevation grid (64 PNG tiles)...", flush=True)
    elev_grid = fetch_terrarium_z3_global()

    land_coords: List[Tuple[int, int, float, float]] = []
    for lat in range(-78, 79):
        for lon in range(-180, 180):
            elev, slope = sample_elev_slope_z3(elev_grid, float(lat), float(lon))
            if elev > 2.0:
                land_coords.append((lat, lon, elev, slope))

    print(f"Identified {len(land_coords)} land cells at 1.0 deg resolution.", flush=True)

    print("2/3 Fetching global 12-month NASA POWER S3 Zarr climatology (T2M, PRECTOTCORR, CLOUD_AMT)...", flush=True)
    coord_pairs = [[lat, lon] for lat, lon, _, _ in land_coords]
    proc = subprocess.run(
        ["node", "-e", NODE_ZARR_FETCHER],
        input=json.dumps(coord_pairs).encode("utf-8"),
        capture_output=True,
        check=True,
    )
    power_quarters = json.loads(proc.stdout.decode("utf-8"))

    print("3/3 Computing seasonal quarters, lithology, karst/lava-tube flags, and classic exclusion mask...", flush=True)
    cells: List[List[float]] = []
    for idx, (lat, lon, elev, slope) in enumerate(land_coords):
        t_q, p_q, c_q = power_quarters[idx]

        q1T, q2T, q3T, q4T = [round(v + 273.15, 1) for v in t_q]
        q1P, q2P, q3P, q4P = [round(min(0.85, max(0.0, (max(0.0, v) / 14.0) ** 1.15)), 2) for v in p_q]
        q1Cld, q2Cld, q3Cld, q4Cld = [round(max(0.0, min(100.0, v)), 1) for v in c_q]

        mean_prec = sum(max(0.0, v) for v in p_q) / 4.0
        mean_temp_c = sum(t_q) / 4.0
        aridity_ndvi = max(0.0, min(0.85, (mean_prec / max(1.0, (mean_temp_c + 25.0) * 0.16)) * 0.45))
        if lat < -64:
            aridity_ndvi = 0.0

        is_lava = in_province(lat, lon, LAVA_TUBE_PROVINCES)
        is_karst = in_province(lat, lon, KARST_CAVE_PROVINCES)
        void_code = 1 if is_lava else (2 if is_karst else 0)

        mafic = 0.56 if is_lava else (0.14 if is_karst else (0.34 if elev > 1200 else 0.28))
        clay = 0.03 if (is_lava or is_karst or mean_prec < 0.8) else min(0.35, 0.05 + mean_prec * 0.05)
        weh = 3.2 if (lat < -65 or (lat > 66 and mean_temp_c < -5)) else (0.6 if mean_prec < 0.8 else 2.2)
        albedo = 0.45 if lat < -64 else (0.13 if is_lava else (0.32 if mean_prec < 0.8 else 0.20))

        is_classic = 0
        if lat < -66:
            is_classic = 1
        else:
            for h_lat, h_lon in classic_hubs:
                if haversine_km(lat, lon, h_lat, h_lon) <= 210.0:
                    is_classic = 1
                    break

        cells.append([
            lat,
            lon,
            round(elev),
            round(slope, 1),
            round(mafic, 2),
            round(clay, 2),
            round(weh, 1),
            round(albedo, 2),
            round(aridity_ndvi, 2),
            is_classic,
            void_code,
            q1T,
            q2T,
            q3T,
            q4T,
            q1P,
            q2P,
            q3P,
            q4P,
            q1Cld,
            q2Cld,
            q3Cld,
            q4Cld,
        ])

    payload = {
        "version": "1.0.0",
        "resolutionDeg": 1.0,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": [
            "AWS Mapzen Terrarium z=3 Global Elevation",
            "NASA POWER S3 Zarr Climatology (MERRA-2 T2M, PRECTOTCORR & SYN1DEG CLOUD_AMT)",
            "WHYMAP WOKAM Karst & Global Basaltic Lava Tube Provinces",
        ],
        "columns": [
            "lat", "lon", "elevM", "slopeMed", "mafic", "clay", "weh", "albedo", "ndvi",
            "isClassic", "voidCode",
            "q1T", "q2T", "q3T", "q4T",
            "q1P", "q2P", "q3P", "q4P",
            "q1Cld", "q2Cld", "q3Cld", "q4Cld",
        ],
        "cells": cells,
    }

    GRID_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(GRID_OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))

    size_bytes = GRID_OUT.stat().st_size
    elapsed = time.time() - t0
    print(f"Wrote {len(cells)} cells -> {GRID_OUT} ({size_bytes / 1024 / 1024:.2f} MB) in {elapsed:.1f}s", flush=True)
    if size_bytes >= 2 * 1024 * 1024:
        raise RuntimeError(f"Grid file {size_bytes} bytes exceeds 2 MB limit!")


if __name__ == "__main__":
    main()
