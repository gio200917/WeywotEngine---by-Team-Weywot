import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useMissionStore } from '../../store/missionStore.js';
import {
  parseCoordinateQuery,
  searchLocalThreeBodies,
  type SearchResultGroup,
  type UnifiedSearchResult,
} from './locationSearch.js';

const GROUP_LABELS: Record<SearchResultGroup, string> = {
  coordinates: 'Coordinates',
  mars: 'Mars Features & Targets',
  moon: 'Moon Features & Targets',
  earth: 'Earth Places & Analogs',
};

const GROUP_ORDER: SearchResultGroup[] = ['coordinates', 'mars', 'moon', 'earth'];

export function UnifiedSearchBar() {
  const {
    targets,
    dossiers,
    probedSites,
    bodyFocus,
    viewComplexity,
    guidedStep,
    inspectPlanetaryPoint,
    selectEarthSite,
    inspectEarthPlace,
  } = useMissionStore();

  const isGuidedPlanetaryOnly = viewComplexity === 'guided' && guidedStep !== 'review';

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [remoteResults, setRemoteResults] = useState<UnifiedSearchResult[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const earthSites = useMemo(() => {
    if (isGuidedPlanetaryOnly) return [];
    const map = new Map<string, (typeof probedSites)[number]>();
    for (const s of probedSites) map.set(s.id, s);
    for (const d of dossiers) {
      for (const c of d.rankedCandidates) {
        if (!map.has(c.site.id)) map.set(c.site.id, c.site);
      }
    }
    return Array.from(map.values());
  }, [probedSites, dossiers, isGuidedPlanetaryOnly]);

  const isCoordinateOnly = useMemo(
    () => parseCoordinateQuery(query, bodyFocus).length > 0,
    [query, bodyFocus]
  );

  const localResults = useMemo(() => {
    const raw = searchLocalThreeBodies(query, targets, earthSites, bodyFocus);
    return isGuidedPlanetaryOnly ? raw.filter((r) => r.body !== 'earth') : raw;
  }, [query, targets, earthSites, bodyFocus, isGuidedPlanetaryOnly]);

  // Debounced Earth geocoder search (Photon / Nominatim via server proxy)
  useEffect(() => {
    const trimmed = query.trim();
    if (isGuidedPlanetaryOnly || trimmed.length < 2 || isCoordinateOnly) {
      setRemoteResults([]);
      setSearchingRemote(false);
      return;
    }

    const controller = new AbortController();
    setSearchingRemote(true);
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetch(
          `/api/v1/search/earth?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!resp.ok) {
          setRemoteResults([]);
          return;
        }
        const data = (await resp.json()) as {
          results?: Array<{
            id: string;
            name: string;
            subtitle: string;
            body: 'earth';
            lat: number;
            lon: number;
          }>;
        };
        const mapped: UnifiedSearchResult[] = (data.results ?? []).map((r) => ({
          id: r.id,
          group: 'earth',
          body: 'earth',
          name: r.name,
          subtitle: r.subtitle,
          lat: r.lat,
          lon: r.lon,
          source: 'geocoder',
        }));
        setRemoteResults(mapped);
      } catch {
        // Ignore abort / offline fallback
        setRemoteResults([]);
      } finally {
        setSearchingRemote(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isCoordinateOnly, isGuidedPlanetaryOnly]);

  // Merge local + remote without duplicates
  const combinedResults = useMemo(() => {
    const merged = [...localResults];
    if (!isGuidedPlanetaryOnly) {
      const seenEarthNames = new Set(
        localResults
          .filter((r) => r.body === 'earth')
          .map((r) => r.name.toLowerCase())
      );
      for (const r of remoteResults) {
        if (!seenEarthNames.has(r.name.toLowerCase())) {
          merged.push(r);
        }
      }
    }
    return merged.slice(0, 18);
  }, [localResults, remoteResults, isGuidedPlanetaryOnly]);

  const groupedSections = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      label: GROUP_LABELS[group],
      items: combinedResults.filter((r) => r.group === group),
    })).filter((s) => s.items.length > 0);
  }, [combinedResults]);

  const flatOrdered = useMemo(
    () => groupedSections.flatMap((s) => s.items),
    [groupedSections]
  );

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const handleSelect = (item: UnifiedSearchResult) => {
    setOpen(false);
    if (item.body === 'mars' || item.body === 'moon') {
      inspectPlanetaryPoint({
        body: item.body,
        lat: item.lat,
        lon: item.lon,
        matchedTargetId: item.targetId ?? null,
        name: item.source === 'coordinate' ? undefined : item.name,
        flyTo: true,
      });
    } else if (isGuidedPlanetaryOnly) {
      return;
    } else if (item.siteId) {
      selectEarthSite(item.siteId, 'dossier');
    } else {
      inspectEarthPlace({
        lat: item.lat,
        lon: item.lon,
        name:
          item.source === 'coordinate'
            ? `Earth (${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°)`
            : item.name,
        subtitle: item.subtitle,
      });
    }
  };

  return (
    <div ref={containerRef} className="relative w-56 sm:w-64 lg:w-72">
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
              setOpen(true);
              return;
            }
            if (e.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(flatOrdered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && flatOrdered[activeIdx]) {
              e.preventDefault();
              handleSelect(flatOrdered[activeIdx]);
            }
          }}
          placeholder={
            isGuidedPlanetaryOnly
              ? 'Search Mars/Moon crater, or lat, lon...'
              : 'Search place, crater, or lat, lon...'
          }
          aria-label="Search Earth, Mars, or Moon places and coordinates"
          className="w-full pl-8 pr-7 py-1 rounded border border-slate-700 bg-[#070a10] text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
        />
        {searchingRemote ? (
          <Loader2 className="w-3 h-3 animate-spin text-cyan-400 absolute right-2" />
        ) : (
          query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRemoteResults([]);
                setOpen(false);
              }}
              aria-label="Clear location search"
              className="absolute right-2 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )
        )}
      </div>

      {open && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 z-[1100] rounded border border-slate-700 bg-[#0d121c] shadow-xl max-h-80 overflow-y-auto">
          {flatOrdered.length === 0 ? (
            <div className="px-3 py-2.5 text-[11px] text-slate-400">
              {searchingRemote
                ? 'Searching global Earth, Mars & Moon gazetteers...'
                : 'No matching feature or coordinate. Try "Beirut", "Tycho", or "18.38, 77.58".'}
            </div>
          ) : (
            groupedSections.map((section) => (
              <div key={section.group} className="border-b border-slate-800 last:border-b-0">
                <div className="px-2.5 py-1 bg-[#090d14] text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  {section.label}
                </div>
                {section.items.map((item) => {
                  const idx = flatOrdered.findIndex((f) => f.id === item.id);
                  const highlighted = idx === activeIdx;
                  const bodyColor =
                    item.body === 'mars'
                      ? 'text-amber-300'
                      : item.body === 'moon'
                        ? 'text-slate-200'
                        : 'text-cyan-300';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => handleSelect(item)}
                      className={`w-full text-left px-2.5 py-1.5 flex items-start gap-2 transition-colors cursor-pointer ${
                        highlighted ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <MapPin className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${bodyColor}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-100 truncate">
                            {item.name}
                          </span>
                          <span className={`text-[10px] font-mono uppercase shrink-0 ${bodyColor}`}>
                            {item.body}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
