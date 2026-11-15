import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useMissionStore } from '../../store/missionStore.js';
import type { CelestialTarget } from '../../types/planetary.js';
import { PLANETARY_GAZETTEER } from './planetaryGazetteer.js';
import { resolveEarthRegion } from '../../engine/earthRegionResolver.js';

function greatCirclePoints(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
  steps = 36
): Array<[number, number]> {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1Deg * toRad;
  const lam1 = lon1Deg * toRad;
  const phi2 = lat2Deg * toRad;
  const lam2 = lon2Deg * toRad;

  const p1 = [
    Math.cos(phi1) * Math.cos(lam1),
    Math.cos(phi1) * Math.sin(lam1),
    Math.sin(phi1),
  ];
  const p2 = [
    Math.cos(phi2) * Math.cos(lam2),
    Math.cos(phi2) * Math.sin(lam2),
    Math.sin(phi2),
  ];

  const dot = Math.max(-1, Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-4) {
    return [
      [lat1Deg, lon1Deg],
      [lat2Deg, lon2Deg],
    ];
  }

  const pts: Array<[number, number]> = [];
  const sinOmega = Math.sin(omega);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * omega) / sinOmega;
    const b = Math.sin(f * omega) / sinOmega;
    const x = a * p1[0] + b * p2[0];
    const y = a * p1[1] + b * p2[1];
    const z = a * p1[2] + b * p2[2];
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg;
    const lon = Math.atan2(y, x) * toDeg;
    pts.push([lat, lon]);
  }
  return pts;
}

function SouthPoleInset({ polarTargets }: { polarTargets: CelestialTarget[] }) {
  const [tileError, setTileError] = useState(false);

  return (
    <div className="absolute bottom-3 left-3 z-[800] w-[212px] rounded-lg border border-slate-700 bg-[#0a0e16]/95 p-2 shadow-lg">
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-300 mb-1.5">
        <span className="font-semibold text-amber-300">Lunar South Pole</span>
        <span className="text-slate-400">LRO Pole Mosaic</span>
      </div>

      <div className="relative w-[194px] h-[194px] rounded border border-slate-800 bg-[#07090e] overflow-hidden">
        {!tileError && (
          <img
            src="/api/v1/tiles/moon/south_pole/0/0/0"
            alt="NASA Moon Trek South Pole Illumination"
            className="w-full h-full object-cover opacity-85"
            onError={() => setTileError(true)}
          />
        )}

        <svg
          viewBox="0 0 194 194"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {/* Stereographic Latitude Rings matching WAC_POLE_ILL_PCT_SOUTH_100M 0/0/0 (~80°S–90°S): 85°S r=45, 80°S r=90 */}
          <circle
            cx={97}
            cy={97}
            r={45}
            fill="none"
            stroke="#334155"
            strokeWidth={0.8}
            strokeDasharray="2 2"
          />
          <circle
            cx={97}
            cy={97}
            r={90}
            fill="none"
            stroke="#475569"
            strokeWidth={1}
          />
          <line x1={97} y1={7} x2={97} y2={187} stroke="#1e293b" strokeWidth={0.8} />
          <line x1={7} y1={97} x2={187} y2={97} stroke="#1e293b" strokeWidth={0.8} />

          {/* Pole crosshair */}
          <circle cx={97} cy={97} r={2} fill="#94a3b8" />
          <text x={101} y={51} fill="#64748b" fontSize={8} fontFamily="monospace">
            85°S
          </text>
          <text x={101} y={16} fill="#64748b" fontSize={8} fontFamily="monospace">
            80°S
          </text>

          {/* Polar Targets */}
          {polarTargets.map((t) => {
            const colatDeg = Math.max(0, 90 - Math.abs(t.lat));
            const rPx = Math.min(89, (colatDeg / 10) * 90);
            const angleRad = ((t.lon - 90) * Math.PI) / 180;
            const px = 97 + rPx * Math.cos(angleRad);
            const py = 97 + rPx * Math.sin(angleRad);
            return (
              <g key={t.id}>
                <circle
                  cx={px}
                  cy={py}
                  r={5}
                  fill="#F59E0B"
                  fillOpacity={0.9}
                  stroke="#07090e"
                  strokeWidth={1.2}
                />
                <text
                  x={Math.min(130, px + 7)}
                  y={Math.max(14, py + 3)}
                  fill="#fcd34d"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {t.name.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-1 text-[10px] font-mono tabular-nums text-slate-400 truncate">
        {polarTargets.map((t) => `${t.lat.toFixed(2)}°, ${t.lon.toFixed(1)}°`).join(' · ')}
      </div>
    </div>
  );
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const earthLabelsLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const iauLabelLayerRef = useRef<L.LayerGroup | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  const {
    targets,
    config,
    dossiers,
    discoveryCells,
    activeTargetTabId,
    bodyFocus,
    focusedPinCoords,
    earthOverlay,
    marsOverlay,
    moonOverlay,
    showLocationLabels,
    showDiscoveryHeatmap,
    probeModeActive,
    probeEarthCoordinate,
    selectedSiteId,
    selectEarthSite,
    inspectPlanetaryPoint,
    inspectEarthCell,
    inspectedPlanetaryPoint,
    inspectedEarthPoint,
    maxSlopeFilterDeg,
  } = useMissionStore();

  const prevPinRef = useRef(focusedPinCoords);

  const crsKind = bodyFocus === 'earth' ? 'epsg3857' : 'epsg4326';

  const polarLunarTargets = useMemo(
    () =>
      targets.filter(
        (t) =>
          t.body === 'moon' &&
          config.targetIds.includes(t.id) &&
          Math.abs(t.lat) > 75
      ),
    [targets, config.targetIds]
  );

  // Initialize or recreate Leaflet Map when CRS switches (Earth 3857 <-> Mars/Moon 4326)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      earthLabelsLayerRef.current = null;
      markerLayerRef.current = null;
      iauLabelLayerRef.current = null;
    }

    const isEarth = crsKind === 'epsg3857';
    const initialFocused =
      focusedPinCoords && focusedPinCoords.body === bodyFocus
        ? ([focusedPinCoords.lat, focusedPinCoords.lon] as [number, number])
        : isEarth
          ? ([20, 0] as [number, number])
          : ([0, 0] as [number, number]);

    const map = L.map(el, {
      crs: isEarth ? L.CRS.EPSG3857 : L.CRS.EPSG4326,
      center: initialFocused,
      zoom: isEarth ? 2 : 1,
      minZoom: isEarth ? 1 : 0,
      maxZoom: isEarth ? 16 : 6,
      worldCopyJump: isEarth,
      maxBounds: isEarth
        ? undefined
        : [
            [-90, -180],
            [90, 180],
          ],
      maxBoundsViscosity: isEarth ? 0 : 1.0,
      zoomControl: true,
    });

    const labelsPane = map.createPane('labelsPane');
    labelsPane.style.zIndex = '460';
    labelsPane.style.pointerEvents = 'none';

    const iauLabels = L.layerGroup().addTo(map);
    const markers = L.layerGroup().addTo(map);
    const canvasRenderer = L.canvas({ padding: 0.3 });
    mapRef.current = map;
    iauLabelLayerRef.current = iauLabels;
    markerLayerRef.current = markers;
    canvasRendererRef.current = canvasRenderer;

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      earthLabelsLayerRef.current = null;
      markerLayerRef.current = null;
      iauLabelLayerRef.current = null;
      canvasRendererRef.current = null;
    };
  }, [crsKind]);

  // Bidirectionally pan/fly MapView when focusedPinCoords changes on active body
  useEffect(() => {
    const map = mapRef.current;
    const prevPin = prevPinRef.current;
    prevPinRef.current = focusedPinCoords;
    if (!map || !focusedPinCoords || focusedPinCoords.body !== bodyFocus) return;
    const changed =
      !prevPin ||
      prevPin.nonce !== focusedPinCoords.nonce ||
      prevPin.lat !== focusedPinCoords.lat ||
      prevPin.lon !== focusedPinCoords.lon ||
      prevPin.body !== focusedPinCoords.body;
    if (!changed) return;

    if (focusedPinCoords.zoom) {
      const targetZoom = Math.max(map.getZoom(), bodyFocus === 'earth' ? 6 : 3);
      map.flyTo([focusedPinCoords.lat, focusedPinCoords.lon], targetZoom, {
        animate: true,
        duration: 0.45,
      });
    } else {
      map.panTo([focusedPinCoords.lat, focusedPinCoords.lon], {
        animate: true,
        duration: 0.45,
      });
    }
  }, [focusedPinCoords, bodyFocus]);

  // Swap tile layer whenever bodyFocus or overlay changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    let layer: L.TileLayer;
    if (bodyFocus === 'earth') {
      if (earthOverlay === 'google_satellite') {
        layer = L.tileLayer(
          'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          {
            subdomains: ['0', '1', '2', '3'],
            maxNativeZoom: 19,
            maxZoom: 18,
            attribution: 'Google Earth Satellite',
          }
        );
      } else if (earthOverlay === 'sentinel_cloudless') {
        layer = L.tileLayer(
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
          {
            maxNativeZoom: 14,
            maxZoom: 18,
            attribution: 'EOX Sentinel-2 Cloudless',
          }
        );
      } else if (earthOverlay === 'aster_gdem') {
        layer = L.tileLayer(
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ASTER_GDEM_Greyscale_Shaded_Relief/default//GoogleMapsCompatible_Level12/{z}/{y}/{x}.png',
          {
            maxNativeZoom: 12,
            maxZoom: 16,
            attribution: 'NASA GIBS ASTER GDEM',
          }
        );
      } else if (earthOverlay === 'osm') {
        layer = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxNativeZoom: 19,
            maxZoom: 18,
            attribution: 'OpenStreetMap contributors',
          }
        );
      } else {
        layer = L.tileLayer(
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
          {
            maxNativeZoom: 8,
            maxZoom: 16,
            attribution: 'NASA GIBS Blue Marble',
          }
        );
      }
    } else if (bodyFocus === 'mars') {
      const marsUrl =
        marsOverlay === 'themis_ir'
          ? '/api/v1/tiles/mars/themis_ir/{z}/{y}/{x}'
          : 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg';
      layer = L.tileLayer(marsUrl, {
        bounds: [
          [-90, -180],
          [90, 180],
        ],
        noWrap: true,
        tileSize: 256,
        minZoom: 0,
        maxNativeZoom: marsOverlay === 'themis_ir' ? 6 : 5,
        maxZoom: 6,
        attribution: 'NASA Mars Trek WMTS',
      });
    } else {
      const moonUrl =
        moonOverlay === 'lro_wac'
          ? 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg'
          : 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg';
      layer = L.tileLayer(moonUrl, {
        bounds: [
          [-90, -180],
          [90, 180],
        ],
        noWrap: true,
        tileSize: 256,
        minZoom: 0,
        maxNativeZoom: 5,
        maxZoom: 6,
        attribution: 'NASA Moon Trek LRO WAC',
      });
    }

    layer.addTo(map);
    layer.bringToBack();
    tileLayerRef.current = layer;
  }, [bodyFocus, earthOverlay, marsOverlay, moonOverlay]);

  // Toggleable 3-body location labels on 2D Map
  useEffect(() => {
    const map = mapRef.current;
    const iauGroup = iauLabelLayerRef.current;
    if (!map || !iauGroup) return;

    if (earthLabelsLayerRef.current) {
      map.removeLayer(earthLabelsLayerRef.current);
      earthLabelsLayerRef.current = null;
    }
    iauGroup.clearLayers();

    if (!showLocationLabels) return;

    if (bodyFocus === 'earth') {
      const labelsLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
        {
          subdomains: ['a', 'b', 'c', 'd'],
          maxNativeZoom: 18,
          maxZoom: 18,
          pane: 'labelsPane',
        }
      );
      labelsLayer.addTo(map);
      earthLabelsLayerRef.current = labelsLayer;

      const earthFeatures = PLANETARY_GAZETTEER.filter((g) => g.body === 'earth');
      for (const f of earthFeatures) {
        const icon = L.divIcon({
          className: 'weywot-iau-label',
          html: `<div style="pointer-events:none;white-space:nowrap;transform:translate(-50%,-50%);font-family:ui-monospace,monospace;font-size:${
            f.tier === 1 ? '10px' : '9px'
          };font-weight:${f.tier === 1 ? '600' : '500'};letter-spacing:${
            f.tier === 1 ? '0.09em' : '0.02em'
          };text-transform:${
            f.tier === 1 ? 'uppercase' : 'none'
          };color:${
            f.tier === 1 ? 'rgba(224,242,254,0.92)' : 'rgba(241,245,249,0.86)'
          };text-shadow:0 1px 3px rgba(0,0,0,0.98),0 0 6px rgba(0,0,0,0.95);">${f.name}</div>`,
          iconSize: [0, 0],
        });
        L.marker([f.lat, f.lon], {
          icon,
          interactive: false,
          pane: 'labelsPane',
        }).addTo(iauGroup);
      }
    } else {
      const features = PLANETARY_GAZETTEER.filter((g) => g.body === bodyFocus);
      for (const f of features) {
        const icon = L.divIcon({
          className: 'weywot-iau-label',
          html: `<div style="pointer-events:none;white-space:nowrap;transform:translate(-50%,-50%);font-family:ui-monospace,monospace;font-size:${
            f.tier === 1 ? '10px' : '9px'
          };font-weight:${f.tier === 1 ? '600' : '400'};letter-spacing:${
            f.tier === 1 ? '0.08em' : '0.02em'
          };text-transform:${f.tier === 1 ? 'uppercase' : 'none'};color:${
            bodyFocus === 'mars'
              ? f.tier === 1
                ? 'rgba(253,230,138,0.92)'
                : 'rgba(252,211,77,0.8)'
              : f.tier === 1
                ? 'rgba(226,232,240,0.92)'
                : 'rgba(203,213,225,0.8)'
          };text-shadow:0 1px 3px rgba(0,0,0,0.98),0 0 6px rgba(0,0,0,0.95);">${f.name}</div>`,
          iconSize: [0, 0],
        });
        L.marker([f.lat, f.lon], {
          icon,
          interactive: false,
          pane: 'labelsPane',
        }).addTo(iauGroup);
      }
    }
  }, [bodyFocus, showLocationLabels, crsKind]);

  // Earth click-to-probe & Mars/Moon click-anywhere inspection handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => {
      const lonNorm = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
      if (bodyFocus === 'earth') {
        if (!probeModeActive) return;
        void probeEarthCoordinate(e.latlng.lat, lonNorm);
        return;
      }
      inspectPlanetaryPoint({
        body: bodyFocus,
        lat: Math.max(-89.9, Math.min(89.9, e.latlng.lat)),
        lon: lonNorm,
        flyTo: false,
      });
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [bodyFocus, probeModeActive, probeEarthCoordinate, inspectPlanetaryPoint]);

  // Render markers, portfolio geodesic lines, and discovery grid hotspots
  useEffect(() => {
    const group = markerLayerRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();

    if (bodyFocus === 'earth') {
      const activeDossier =
        dossiers.find((d) => d.target.id === activeTargetTabId) ?? dossiers[0];

      // 1° × 1° Screening Analog Cells (top 2200 matching 3D Globe cap via Canvas renderer)
      if (showDiscoveryHeatmap && discoveryCells.length > 0) {
        const topCells = [...discoveryCells]
          .sort((a, b) => b.scorePct - a.scorePct)
          .slice(0, 2200);
        const canvasRenderer = canvasRendererRef.current ?? undefined;
        for (const cell of topCells) {
          const color =
            cell.scorePct >= 68
              ? '#10b981'
              : cell.scorePct >= 54
                ? '#06b6d4'
                : '#f59e0b';
          const region = resolveEarthRegion(cell.lat, cell.lon);
          const rect = L.rectangle(
            [
              [cell.lat - 0.45, cell.lon - 0.45],
              [cell.lat + 0.45, cell.lon + 0.45],
            ],
            {
              renderer: canvasRenderer,
              color,
              fillColor: color,
              fillOpacity: 0.22,
              opacity: 0.5,
              weight: 0.7,
            }
          );
          rect.bindTooltip(
            `${region.name} (${cell.lat.toFixed(1)}°, ${cell.lon.toFixed(1)}°) · Fit ${cell.scorePct.toFixed(1)}% · Best Q${cell.bestQuarter}`,
            { direction: 'top' }
          );
          rect.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            if (config.targetIds.length === 0) return;
            if (probeModeActive) {
              void probeEarthCoordinate(cell.lat, cell.lon);
            } else {
              inspectEarthCell({
                lat: cell.lat,
                lon: cell.lon,
                scorePct: cell.scorePct,
                bestQuarter: cell.bestQuarter,
              });
            }
          });
          rect.addTo(group);
        }
      }

      const arcDossiers =
        activeTargetTabId === 'portfolio'
          ? dossiers
          : activeDossier
            ? [activeDossier]
            : [];

      for (const d of arcDossiers) {
        if (!d.portfolio) continue;
        const { siteA, siteB, combinedMinimaxPct } = d.portfolio;
        const pts = greatCirclePoints(siteA.lat, siteA.lon, siteB.lat, siteB.lon);
        const line = L.polyline(pts, {
          color: '#10b981',
          weight: 2,
          dashArray: '6 4',
          opacity: 0.9,
        });
        line.bindTooltip(
          `2-Site Split (${d.target.name}): ${siteA.name.replace(/\s*\(Visual Anti-Analog\)/i, '')} + ${siteB.name.replace(/\s*\(Visual Anti-Analog\)/i, '')} (${combinedMinimaxPct.toFixed(1)}%)`
        );
        line.addTo(group);
      }

      if (activeDossier) {
        // Tiered Ranked Earth Analog Pins (#1-#10 numbered badges, #11+ compact markers)
        const visibleCandidates = activeDossier.rankedCandidates.filter(
          (c) => c.site.morphology.medianSlopeDeg <= maxSlopeFilterDeg
        );

        for (const cand of visibleCandidates) {
          const isSelected = selectedSiteId === cand.site.id;
          const isTop10 = cand.rank <= 10;
          const cleanName = cand.site.name.replace(/\s*\(Visual Anti-Analog\)/i, '');

          if (isSelected || isTop10) {
            const size = isSelected ? 24 : cand.rank <= 3 ? 21 : 18;
            const bg = isSelected ? '#22d3ee' : '#07090e';
            const fg = isSelected ? '#07090e' : cand.rank <= 3 ? '#22d3ee' : '#67e8f9';
            const border = isSelected ? '#ffffff' : cand.rank <= 3 ? '#22d3ee' : '#06b6d4';
            const icon = L.divIcon({
              className: 'weywot-rank-pin',
              html: `<div style="width:${size}px;height:${size}px;border-radius:2px;background:${bg};border:${isSelected ? '2px' : '1.5px'} solid ${border};color:${fg};font-family:'IBM Plex Mono',monospace;font-size:${size > 20 ? 10 : 9}px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.85);cursor:pointer;">${cand.rank}</div>`,
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            });
            const m = L.marker([cand.site.lat, cand.site.lon], {
              icon,
              zIndexOffset: isSelected ? 600 : 300 - cand.rank,
            });
            m.bindTooltip(
              `#${cand.rank} ${cleanName} · ${cand.missionFitPct.toFixed(1)}% (${cand.earthFrontierPct.toFixed(0)}% frontier)`,
              { direction: 'top' }
            );
            m.on('click', (ev) => {
              L.DomEvent.stopPropagation(ev);
              selectEarthSite(cand.site.id, 'viewport');
            });
            m.addTo(group);
          } else {
            const cm = L.circleMarker([cand.site.lat, cand.site.lon], {
              radius: 4.5,
              color: '#06b6d4',
              fillColor: '#0891b2',
              fillOpacity: 0.72,
              weight: 1,
            });
            cm.bindTooltip(
              `#${cand.rank} ${cleanName} · ${cand.missionFitPct.toFixed(1)}% (${cand.earthFrontierPct.toFixed(0)}% frontier)`,
              { direction: 'top' }
            );
            cm.on('click', (ev) => {
              L.DomEvent.stopPropagation(ev);
              selectEarthSite(cand.site.id, 'viewport');
            });
            cm.addTo(group);
          }
        }
      }

      if (inspectedEarthPoint) {
        if (inspectedEarthPoint.sourceKind === 'cell') {
          L.rectangle(
            [
              [inspectedEarthPoint.lat - 0.5, inspectedEarthPoint.lon - 0.5],
              [inspectedEarthPoint.lat + 0.5, inspectedEarthPoint.lon + 0.5],
            ],
            {
              color: '#22d3ee',
              fillColor: '#06b6d4',
              fillOpacity: 0.25,
              weight: 2,
              interactive: false,
            }
          ).addTo(group);
        } else {
          L.circleMarker([inspectedEarthPoint.lat, inspectedEarthPoint.lon], {
            radius: 10,
            color: '#22d3ee',
            fillColor: '#06b6d4',
            fillOpacity: 0.28,
            weight: 2,
            dashArray: '4 3',
            interactive: false,
          }).addTo(group);
        }
      }
    } else {
      // Mars or Moon Target Crosshair Reticles
      const bodyTargets = targets.filter((t) => t.body === bodyFocus);
      for (const t of bodyTargets) {
        const isActive = config.targetIds.includes(t.id);
        const isFocused = activeTargetTabId === t.id;
        const size = isFocused ? 28 : isActive ? 24 : 18;
        const stroke = isFocused ? '#fef3c7' : isActive ? '#f59e0b' : '#b45309';
        const svg = `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.9));"><circle cx="14" cy="14" r="9" stroke="${stroke}" stroke-width="1.6"/><polygon points="14,7 19,14 14,21 9,14" fill="${stroke}" fill-opacity="0.28" stroke="${stroke}" stroke-width="1.3"/><line x1="14" y1="1.5" x2="14" y2="5.5" stroke="${stroke}" stroke-width="1.5"/><line x1="14" y1="22.5" x2="14" y2="26.5" stroke="${stroke}" stroke-width="1.5"/><line x1="1.5" y1="14" x2="5.5" y2="14" stroke="${stroke}" stroke-width="1.5"/><line x1="22.5" y1="14" x2="26.5" y2="14" stroke="${stroke}" stroke-width="1.5"/></svg>`;
        const icon = L.divIcon({
          className: 'weywot-target-reticle',
          html: svg,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const marker = L.marker([t.lat, t.lon], {
          icon,
          zIndexOffset: isFocused ? 500 : 300,
        });
        marker.bindTooltip(
          `${t.name} (${t.lat.toFixed(2)}°, ${t.lon.toFixed(2)}°)${isActive ? ' · ACTIVE TARGET' : ''}`,
          { direction: 'top' }
        );
        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          inspectPlanetaryPoint({
            body: t.body,
            lat: t.lat,
            lon: t.lon,
            matchedTargetId: t.id,
            flyTo: false,
          });
        });
        marker.addTo(group);
      }

      if (inspectedPlanetaryPoint && inspectedPlanetaryPoint.body === bodyFocus) {
        L.circleMarker([inspectedPlanetaryPoint.lat, inspectedPlanetaryPoint.lon], {
          radius: 11,
          color: '#fbbf24',
          fillColor: '#f59e0b',
          fillOpacity: 0.25,
          weight: 2,
          dashArray: '4 3',
          interactive: false,
        }).addTo(group);
      }
    }
  }, [
    bodyFocus,
    dossiers,
    activeTargetTabId,
    showDiscoveryHeatmap,
    discoveryCells,
    selectedSiteId,
    maxSlopeFilterDeg,
    targets,
    config.targetIds,
    inspectedPlanetaryPoint,
    inspectedEarthPoint,
    probeModeActive,
    selectEarthSite,
    inspectPlanetaryPoint,
    inspectEarthCell,
    probeEarthCoordinate,
  ]);

  return (
    <div className="relative w-full h-full bg-[#07090e]">
      <div
        ref={containerRef}
        className={`w-full h-full ${
          bodyFocus === 'earth' && probeModeActive
            ? 'cursor-crosshair'
            : bodyFocus !== 'earth'
              ? 'cursor-crosshair'
              : ''
        }`}
      />

      {/* Legend Bar */}
      <div className="pointer-events-none absolute top-3 right-3 z-[700] px-2.5 py-1.5 rounded border border-slate-800 bg-[#0a0e16]/90 text-[10px] font-mono text-slate-300 flex items-center gap-3">
        {bodyFocus === 'earth' ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-[1px] border border-cyan-400 bg-cyan-400" />
              Ranked Analog
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 bg-emerald-400/70 border border-emerald-400" />
              1° Cell
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-emerald-400" />
              2-Site Arc
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rotate-45 bg-amber-400" />
            {bodyFocus.toUpperCase()} Target Reticle
          </span>
        )}
      </div>

      {/* Auto Lunar South Pole Stereographic Inset */}
      {polarLunarTargets.length > 0 && (
        <SouthPoleInset polarTargets={polarLunarTargets} />
      )}
    </div>
  );
}
