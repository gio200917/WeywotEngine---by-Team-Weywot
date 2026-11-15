#!/usr/bin/env python3
"""
Offline catalog seeder for WeywotEngine (Slice 1).
Hydrates:
  - Real 10-year (2015-2024) 12-month NASA POWER daily climatologies (2 parallel calls: AG + RE, <=15 params each, filtering -999)
  - Real AWS Mapzen Terrarium z=12 RGB PNG elevation + Horn 3x3 slope over 32x32 patch
  - Best-effort Macrostrat v2 geologic lithology enrichment (+ optional SoilGrids with >=13s throttle)
  - Cited laboratory/field literature values from scripts/raw_literature_overrides.json
Writes:
  - src/data/celestial_targets.json
  - src/data/tier1_earth_catalog.json
"""

import argparse
import concurrent.futures
import json
import math
import os
import statistics
import struct
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
OVERRIDES_PATH = ROOT / "scripts" / "raw_literature_overrides.json"
TARGETS_OUT = ROOT / "src" / "data" / "celestial_targets.json"
CATALOG_OUT = ROOT / "src" / "data" / "tier1_earth_catalog.json"

MID_MONTH_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]
USER_AGENT = "WeywotEngine-Seeder/1.0"


def http_get_bytes(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_json(url: str, timeout: int = 25) -> Any:
    raw = http_get_bytes(url, timeout=timeout)
    return json.loads(raw.decode("utf-8"))


def compute_earth_grazing_sun_hours(lat_deg: float, month: int, clear_sky: float) -> float:
    doy = MID_MONTH_DOY[max(0, min(11, month - 1))]
    decl = math.radians(23.44) * math.sin(2.0 * math.pi * (doy - 81) / 365.25)
    lat_r = math.radians(lat_deg)
    steps = 0
    for i in range(96):
        hour = i * 0.25
        ha = math.radians((hour - 12.0) * 15.0)
        sin_b = math.sin(lat_r) * math.sin(decl) + math.cos(lat_r) * math.cos(decl) * math.cos(ha)
        sin_b = max(-1.0, min(1.0, sin_b))
        beta = math.degrees(math.asin(sin_b))
        if 0.0 < beta < 10.0:
            steps += 1
    return round(steps * 0.25 * max(0.0, min(1.0, clear_sky)), 3)


def decode_png_rgb(png_bytes: bytes) -> Tuple[int, int, List[List[Tuple[int, int, int]]]]:
    """Pure-Python PNG decoder for 8-bit RGB/RGBA Terrarium tiles."""
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG header")
    pos = 8
    width = height = 0
    bit_depth = color_type = 0
    idat_chunks: List[bytes] = []

    while pos < len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
        ctype = png_bytes[pos + 4 : pos + 8]
        data = png_bytes[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", data)
        elif ctype == b"IDAT":
            idat_chunks.append(data)
        elif ctype == b"IEND":
            break

    if bit_depth != 8 or color_type not in (2, 6):
        raise ValueError(f"Unsupported PNG format bit_depth={bit_depth} color_type={color_type}")

    bpp = 3 if color_type == 2 else 4
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat_chunks))

    def paeth(a: int, b: int, c: int) -> int:
        p = a + b - c
        pa = abs(p - a)
        pb = abs(p - b)
        pc = abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        if pb <= pc:
            return b
        return c

    prev_row = bytearray(stride)
    pixels: List[List[Tuple[int, int, int]]] = []
    idx = 0
    for _ in range(height):
        ftype = raw[idx]
        idx += 1
        scan = bytearray(raw[idx : idx + stride])
        idx += stride
        recon = bytearray(stride)
        for i in range(stride):
            x = scan[i]
            a = recon[i - bpp] if i >= bpp else 0
            b = prev_row[i]
            c = prev_row[i - bpp] if i >= bpp else 0
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
            else:
                raise ValueError(f"Unknown PNG filter {ftype}")
        prev_row = recon
        row_rgb: List[Tuple[int, int, int]] = []
        for col in range(width):
            off = col * bpp
            row_rgb.append((recon[off], recon[off + 1], recon[off + 2]))
        pixels.append(row_rgb)

    return width, height, pixels


def latlon_to_tile_pixel(lat: float, lon: float, z: int = 12) -> Tuple[int, int, int, int]:
    lat_c = max(-85.0511, min(85.0511, lat))
    n = 2 ** z
    x_float = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat_c)
    y_float = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    tx = int(x_float) % n
    ty = max(0, min(n - 1, int(y_float)))
    px = max(0, min(255, int((x_float - math.floor(x_float)) * 256)))
    py = max(0, min(255, int((y_float - math.floor(y_float)) * 256)))
    return tx, ty, px, py


def fetch_terrarium_patch(lat: float, lon: float, z: int = 12) -> Optional[Dict[str, float]]:
    if abs(lat) > 85.0:
        return None
    tx, ty, px, py = latlon_to_tile_pixel(lat, lon, z)
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
    try:
        png_bytes = http_get_bytes(url, timeout=15)
        w, h, rgb = decode_png_rgb(png_bytes)
        elev = [[(r * 256.0 + g + b / 256.0) - 32768.0 for (r, g, b) in row] for row in rgb]
        center_elev = elev[py][px]

        # Pixel resolution in meters at latitude
        res_m = (156543.03392 * math.cos(math.radians(lat))) / (2 ** z)
        res_m = max(5.0, res_m)

        # Horn's 3x3 slope over 32x32 patch centered at (px, py)
        half = 16
        x0 = max(1, min(w - 33, px - half))
        y0 = max(1, min(h - 33, py - half))
        slopes: List[float] = []
        for y in range(y0, min(h - 1, y0 + 32)):
            for x in range(x0, min(w - 1, x0 + 32)):
                a = elev[y - 1][x - 1]
                b = elev[y - 1][x]
                c = elev[y - 1][x + 1]
                d = elev[y][x - 1]
                f = elev[y][x + 1]
                g = elev[y + 1][x - 1]
                h_v = elev[y + 1][x]
                i_v = elev[y + 1][x + 1]
                dz_dx = ((c + 2 * f + i_v) - (a + 2 * d + g)) / (8.0 * res_m)
                dz_dy = ((g + 2 * h_v + i_v) - (a + 2 * b + c)) / (8.0 * res_m)
                slope_deg = math.degrees(math.atan(math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy)))
                slopes.append(slope_deg)

        slopes.sort()
        med_slope = statistics.median(slopes) if slopes else 0.0
        p95_idx = min(len(slopes) - 1, int(0.95 * len(slopes)))
        p95_slope = slopes[p95_idx] if slopes else 0.0
        return {
            "elevationM": round(center_elev, 1),
            "medianSlopeDeg": round(med_slope, 2),
            "p95SlopeDeg": round(p95_slope, 2),
            "resolutionM": round(res_m, 1),
        }
    except Exception:
        return None


def fetch_nasa_power_10yr(lat: float, lon: float) -> Tuple[List[Dict[str, float]], Optional[float]]:
    """
    2 parallel NASA POWER daily/point calls (2015-2024, <=15 params each), filtering -999 fills.
    Returns (12 monthly bins, annual mean valid albedo or None).
    """
    ag_url = (
        f"https://power.larc.nasa.gov/api/temporal/daily/point?"
        f"parameters=T2M,T2M_MIN,T2M_MAX,PRECTOTCORR,PS,GWETTOP,SNODP"
        f"&community=AG&longitude={lon}&latitude={lat}&start=20150101&end=20241231&format=JSON"
    )
    re_url = (
        f"https://power.larc.nasa.gov/api/temporal/daily/point?"
        f"parameters=ALLSKY_SRF_ALB,ALLSKY_SFC_UVA,ALLSKY_SFC_UVB,CLOUD_AMT"
        f"&community=RE&longitude={lon}&latitude={lat}&start=20150101&end=20241231&format=JSON"
    )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_ag = pool.submit(http_get_json, ag_url, 40)
        f_re = pool.submit(http_get_json, re_url, 40)
        ag_json = f_ag.result()
        re_json = f_re.result()

    ag_p = ag_json["properties"]["parameter"]
    re_p = re_json["properties"]["parameter"]

    def valid(val: Any) -> bool:
        return isinstance(val, (int, float)) and val > -900.0 and math.isfinite(val)

    monthly_bins: List[Dict[str, float]] = []
    all_albedos: List[float] = []

    for m in range(1, 13):
        m_str = f"{m:02d}"
        t2m_vals: List[float] = []
        diurnal_vals: List[float] = []
        precip_vals: List[float] = []
        ps_vals: List[float] = []
        gwet_vals: List[float] = []
        snodp_vals: List[float] = []
        uv_vals: List[float] = []
        cld_vals: List[float] = []
        alb_vals: List[float] = []

        for date_key, t_val in ag_p["T2M"].items():
            if date_key[4:6] != m_str:
                continue
            if valid(t_val):
                t2m_vals.append(float(t_val) + 273.15)
            tmin = ag_p["T2M_MIN"].get(date_key, -999)
            tmax = ag_p["T2M_MAX"].get(date_key, -999)
            if valid(tmin) and valid(tmax):
                diurnal_vals.append(max(0.5, float(tmax) - float(tmin)))
            pr = ag_p["PRECTOTCORR"].get(date_key, -999)
            if valid(pr):
                precip_vals.append(float(pr))
            ps = ag_p["PS"].get(date_key, -999)
            if valid(ps):
                ps_vals.append(float(ps))
            gw = ag_p["GWETTOP"].get(date_key, -999)
            if valid(gw):
                gwet_vals.append(max(0.0, min(1.0, float(gw))))
            sn = ag_p["SNODP"].get(date_key, -999)
            if valid(sn):
                snodp_vals.append(max(0.0, float(sn)))

            uva = re_p["ALLSKY_SFC_UVA"].get(date_key, -999)
            uvb = re_p["ALLSKY_SFC_UVB"].get(date_key, -999)
            if valid(uva) and valid(uvb):
                uv_vals.append(max(0.0, float(uva) + float(uvb)))
            elif valid(uva):
                uv_vals.append(max(0.0, float(uva)))

            cld = re_p["CLOUD_AMT"].get(date_key, -999)
            if valid(cld):
                cld_vals.append(max(0.0, min(100.0, float(cld))))

            alb = re_p["ALLSKY_SRF_ALB"].get(date_key, -999)
            if valid(alb) and 0.01 <= float(alb) <= 0.98:
                alb_vals.append(float(alb))
                all_albedos.append(float(alb))

        t_mean_k = statistics.mean(t2m_vals) if t2m_vals else 273.15
        t_std_k = statistics.pstdev(t2m_vals) if len(t2m_vals) > 1 else 3.0
        diurnal_k = statistics.mean(diurnal_vals) if diurnal_vals else 10.0
        p_gt5 = (sum(1 for p in precip_vals if p > 5.0) / len(precip_vals)) if precip_vals else 0.02
        ps_kpa = statistics.mean(ps_vals) if ps_vals else 95.0
        rho_a = (ps_kpa * 1000.0) / (287.058 * max(150.0, t_mean_k))
        uv_ab = statistics.mean(uv_vals) if uv_vals else 15.0
        cld_pct = statistics.mean(cld_vals) if cld_vals else 35.0
        clear_sky = max(0.0, min(1.0, 1.0 - cld_pct / 100.0))
        grazing = compute_earth_grazing_sun_hours(lat, m, clear_sky)
        snow_cm = statistics.mean(snodp_vals) if snodp_vals else 0.0
        gwet = statistics.mean(gwet_vals) if gwet_vals else 0.25

        monthly_bins.append({
            "month": m,
            "tMeanK": round(t_mean_k, 2),
            "tStdK": round(t_std_k, 2),
            "diurnalDeltaK": round(diurnal_k, 2),
            "pPrecipGt5Mm": round(p_gt5, 4),
            "pressureKpa": round(ps_kpa, 2),
            "ambientDensityKgM3": round(rho_a, 4),
            "uvAbFluxWm2": round(uv_ab, 2),
            "clearSkyFraction": round(clear_sky, 3),
            "grazingSunHoursPerDay": grazing,
            "snowDepthCm": round(snow_cm, 2),
            "gwettop": round(gwet, 3),
        })

    mean_alb = round(statistics.mean(all_albedos), 3) if all_albedos else None
    return monthly_bins, mean_alb


def fetch_macrostrat(lat: float, lon: float) -> Optional[str]:
    url = f"https://macrostrat.org/api/v2/geologic_units/map?lat={lat}&lng={lon}"
    try:
        data = http_get_json(url, timeout=10)
        units = data.get("success", {}).get("data", [])
        if units:
            top = units[0]
            name = top.get("unit_name") or top.get("strat_name") or ""
            lith = top.get("lith") or ""
            combined = f"{name} ({lith})".strip(" ()")
            return combined if combined else None
    except Exception:
        return None
    return None


def fetch_soilgrids_clay_optional(lat: float, lon: float) -> Optional[float]:
    if lat < -60.0:
        return None
    url = (
        f"https://rest.isric.org/soilgrids/v2.0/properties/query?"
        f"lon={lon}&lat={lat}&property=clay&depth=0-5cm&value=mean"
    )
    try:
        data = http_get_json(url, timeout=12)
        layers = data.get("properties", {}).get("layers", [])
        for layer in layers:
            if layer.get("name") == "clay":
                val = layer["depths"][0]["values"].get("mean")
                if val is not None:
                    # SoilGrids clay is in g/kg (0..1000)
                    return round(max(0.0, min(1.0, float(val) / 1000.0)), 3)
    except Exception:
        return None
    return None


def hydrate_site(raw_site: Dict[str, Any], use_soilgrids: bool = False) -> Dict[str, Any]:
    site = json.loads(json.dumps(raw_site))
    lat = site["lat"]
    lon = site["lon"]

    monthly, power_alb = fetch_nasa_power_10yr(lat, lon)
    terrarium = fetch_terrarium_patch(lat, lon, z=12)
    macro_lith = fetch_macrostrat(lat, lon)

    soil_clay = None
    if use_soilgrids:
        soil_clay = fetch_soilgrids_clay_optional(lat, lon)
        time.sleep(13.2)  # Mandatory SoilGrids 5 req/min throttle

    if macro_lith:
        site["geology"]["macrostratLithology"] = f"{site['geology'].get('macrostratLithology', '')} [Macrostrat: {macro_lith}]".strip()

    # Keep curated outcrop albedo if POWER albedo is snow-seasonal or missing, else record in lineage
    lineage = [
        {
            "domain": "thermal",
            "source": "NASA POWER Daily API (2015-2024)",
            "detail": f"10-yr daily T2M/T2M_MIN/T2M_MAX/UVA/UVB/ALB ({'ALB=' + str(power_alb) if power_alb else 'literature albedo'})",
            "resolutionOrPeriod": "0.5 deg x 0.625 deg / 2015-2024",
        },
        {
            "domain": "atmospheric",
            "source": "NASA POWER PS + Shao-Lu (2000)",
            "detail": "Surface pressure kPa -> ambient density & analytical cohesive saltation threshold u*t",
            "resolutionOrPeriod": "2015-2024 daily climatology",
        },
        {
            "domain": "operations",
            "source": "NASA POWER PRECTOTCORR / CLOUD_AMT / SNODP + Ephemeris",
            "detail": "12-mo storm exceedance (>5 mm), clear-sky fraction & 96-step grazing-sun hours",
            "resolutionOrPeriod": "2015-2024 daily climatology",
        },
        {
            "domain": "geochemistry",
            "source": "Literature XRF/Spectral + Macrostrat v2" + (" + SoilGrids" if soil_clay is not None else ""),
            "detail": site["geology"].get("macrostratLithology", "Cited field XRF"),
            "resolutionOrPeriod": "Site outcrop scale",
        },
        {
            "domain": "morphology",
            "source": "AWS Mapzen Terrarium z=12 + Field DTM/SAR",
            "detail": (
                f"Terrarium z=12 patch elev={terrarium['elevationM']}m, medSlope={terrarium['medianSlopeDeg']} deg (lit={site['morphology']['medianSlopeDeg']} deg)"
                if terrarium
                else "Cited field DTM / SAR backscatter"
            ),
            "resolutionOrPeriod": f"{site['morphology']['dtmResolutionM']} m",
        },
    ]

    if site["voidProfile"]["voidType"] != "none":
        lineage.append({
            "domain": "void",
            "source": "ASU Ronald Greeley Lava Tube DB / WHYMAP WOKAM",
            "detail": f"{site['voidProfile']['voidType']} span={site['voidProfile']['voidSpanWidthM']}m, deltaT={site['voidProfile']['subterraneanDeltaTK']}K",
            "resolutionOrPeriod": "Subterranean survey",
        })

    if site["isruProfile"]["constructionFeedstockSuitability"] > 0.5:
        lineage.append({
            "domain": "isru",
            "source": "NASA Simulant / Oxide ISRU Registry",
            "detail": f"Simulant={site['geology'].get('simulantNearest', 'N/A')}, O2 potential={site['isruProfile']['ilmeniteO2YieldPotential']}",
            "resolutionOrPeriod": "Laboratory characterization",
        })

    site["provenanceTier"] = "tier1_literature_plus_nasa"
    site["monthly"] = monthly
    site["dataLineage"] = lineage
    return site


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed WeywotEngine Tier-1 Earth & Celestial datasets")
    parser.add_argument("--soilgrids", action="store_true", help="Also query ISRIC SoilGrids (>=13s sleep per site)")
    args = parser.parse_args()

    with open(OVERRIDES_PATH, "r", encoding="utf-8") as f:
        overrides = json.load(f)

    TARGETS_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(TARGETS_OUT, "w", encoding="utf-8") as f:
        json.dump(overrides["celestialTargets"], f, indent=2)
    print(f"Wrote {len(overrides['celestialTargets'])} celestial targets -> {TARGETS_OUT}")

    raw_sites = overrides["earthSites"]
    hydrated: List[Dict[str, Any]] = [None] * len(raw_sites)  # type: ignore

    max_workers = 1 if args.soilgrids else 6
    t_start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {
            pool.submit(hydrate_site, s, args.soilgrids): idx
            for idx, s in enumerate(raw_sites)
        }
        for fut in concurrent.futures.as_completed(future_map):
            idx = future_map[fut]
            res = fut.result()
            hydrated[idx] = res
            print(f"  [{idx+1}/{len(raw_sites)}] Hydrated {res['name']} (Jan T={res['monthly'][0]['tMeanK']}K, Jul T={res['monthly'][6]['tMeanK']}K)")

    with open(CATALOG_OUT, "w", encoding="utf-8") as f:
        json.dump(hydrated, f, indent=2)

    elapsed = time.time() - t_start
    print(f"Wrote {len(hydrated)} Tier-1 Earth sites -> {CATALOG_OUT} in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
