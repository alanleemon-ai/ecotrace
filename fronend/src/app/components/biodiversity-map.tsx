import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Layers, Loader2, MapPin, Minus, Plus } from "lucide-react";
import {
  getSpatialOverlays,
  type SpatialLayerAResponse,
  type SpatialOverlayFeature,
  type SpatialOverlaysResponse,
  type SpatialThreatenedOccurrence,
} from "../../lib/api";
import type { SpatialSite } from "./spatial-context-bar";

type LayerKey = "ala" | "capad" | "ibra" | "kba" | "snes";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
}

interface MapPoint {
  lat: number;
  lon: number;
  label: string;
}

export interface SpatialOverlaySummary {
  protectedAreaCount: number;
  protectedAreaLabel: string;
  bioregionCount: number;
  bioregionLabel: string;
  kbaCount: number;
  kbaLabel: string;
  loading: boolean;
  error: string | null;
}

const VIEW_W = 800;
const VIEW_H = 600;
const TILE_SIZE = 256;

const layerConfig: { key: LayerKey; label: string; swatch: string }[] = [
  { key: "ala", label: "Threatened Occurrences", swatch: "bg-rose-500" },
  { key: "capad", label: "Protected Areas", swatch: "bg-emerald-500" },
  { key: "ibra", label: "Bioregions", swatch: "bg-sky-500" },
  { key: "kba", label: "Key Biodiversity Areas", swatch: "bg-blue-600" },
  { key: "snes", label: "Sensitive Habitats", swatch: "bg-amber-500" },
];

function locationCountry(layerA?: SpatialLayerAResponse | null) {
  const inferred = layerA?.inferred_location;
  const location = layerA?.location && "country" in layerA.location ? layerA.location : null;
  return inferred?.country || location?.country || "Australia";
}

function locationState(layerA?: SpatialLayerAResponse | null) {
  const inferred = layerA?.inferred_location;
  const location = layerA?.location && "state" in layerA.location ? layerA.location : null;
  return layerA?.company?.state || inferred?.state || location?.state || "";
}

function locationPostcode(layerA?: SpatialLayerAResponse | null) {
  const inferred = layerA?.inferred_location;
  const location = layerA?.location && "postcode" in layerA.location ? layerA.location : null;
  return layerA?.company?.postcode || inferred?.postcode || location?.postcode || "";
}

function fallbackPoint(site: SpatialSite, layerA?: SpatialLayerAResponse | null): MapPoint {
  const inferred = layerA?.inferred_location;
  const location = layerA?.location;
  const locationLabel = location && "label" in location && typeof location.label === "string"
    ? location.label
    : null;

  return {
    lat: inferred?.lat ?? location?.lat ?? site.lat,
    lon: inferred?.lon ?? location?.lon ?? site.lon,
    label: inferred?.label || locationLabel || site.name,
  };
}

function occurrenceColor(category?: string | null) {
  if (category === "CR") return "rgba(190,18,60,0.95)";
  if (category === "EN") return "rgba(225,29,72,0.9)";
  return "rgba(244,63,94,0.82)";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const safeLat = clamp(lat, -85.0511, 85.0511);
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function worldToLonLat(x: number, y: number, zoom: number): MapPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return {
    lat: clamp(lat, -85.0511, 85.0511),
    lon: ((((lon + 180) % 360) + 360) % 360) - 180,
    label: "Map view",
  };
}

function zoomForRadius(radiusKm: number, lat: number) {
  const targetMetersPerPixel = Math.max(10, (Math.max(radiusKm, 1) * 1000) / 260);
  const zoom = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / targetMetersPerPixel);
  return clamp(Math.round(zoom), 7, 14);
}

function projectLonLat(center: MapPoint, zoom: number, lon: number, lat: number) {
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom);
  const pointWorld = lonLatToWorld(lon, lat, zoom);
  return {
    x: VIEW_W / 2 + pointWorld.x - centerWorld.x,
    y: VIEW_H / 2 + pointWorld.y - centerWorld.y,
  };
}

function projectOccurrence(center: MapPoint, zoom: number, occurrence: SpatialThreatenedOccurrence) {
  return projectLonLat(center, zoom, occurrence.lon, occurrence.lat);
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function polygonRings(feature: SpatialOverlayFeature): [number, number][][] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[])
      .filter(Array.isArray)
      .map((ring) => (ring as unknown[]).filter(isCoordinate));
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[]).flatMap((polygon) =>
      Array.isArray(polygon)
        ? (polygon as unknown[])
            .filter(Array.isArray)
            .map((ring) => (ring as unknown[]).filter(isCoordinate))
        : [],
    );
  }
  return [];
}

function ringPath(center: MapPoint, zoom: number, ring: [number, number][]) {
  if (ring.length < 3) return "";
  const commands = ring.map(([lon, lat], index) => {
    const point = projectLonLat(center, zoom, lon, lat);
    return `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  });
  return `${commands.join(" ")} Z`;
}

function osmTiles(center: MapPoint, zoom: number) {
  const tileZoom = Math.trunc(clamp(Math.floor(zoom), 1, 19));
  const tileScale = 2 ** (zoom - tileZoom);
  const centerWorld = lonLatToWorld(center.lon, center.lat, tileZoom);
  const viewWorldW = VIEW_W / tileScale;
  const viewWorldH = VIEW_H / tileScale;
  const topLeft = {
    x: centerWorld.x - viewWorldW / 2,
    y: centerWorld.y - viewWorldH / 2,
  };
  const maxTile = 2 ** tileZoom;
  const startX = Math.floor(topLeft.x / TILE_SIZE);
  const endX = Math.floor((topLeft.x + viewWorldW) / TILE_SIZE);
  const startY = Math.floor(topLeft.y / TILE_SIZE);
  const endY = Math.floor((topLeft.y + viewWorldH) / TILE_SIZE);
  const tiles = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      const left = (x * TILE_SIZE - topLeft.x) * tileScale;
      const top = (y * TILE_SIZE - topLeft.y) * tileScale;
      tiles.push({
        key: `${tileZoom}-${x}-${y}`,
        url: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${y}.png`,
        left: `${(left / VIEW_W) * 100}%`,
        top: `${(top / VIEW_H) * 100}%`,
        width: `${((TILE_SIZE * tileScale) / VIEW_W) * 100}%`,
        height: `${((TILE_SIZE * tileScale) / VIEW_H) * 100}%`,
      });
    }
  }
  return tiles;
}

function OverlayPaths({
  features,
  center,
  zoom,
  className,
  fill,
  stroke,
  strokeDasharray,
  strokeWidth = 1.4,
}: {
  features: SpatialOverlayFeature[];
  center: MapPoint;
  zoom: number;
  className?: string;
  fill: string;
  stroke: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}) {
  return (
    <svg className={`pointer-events-none absolute inset-0 h-full w-full ${className || ""}`} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
      {features.flatMap((feature, featureIndex) =>
        polygonRings(feature).map((ring, ringIndex) => {
          const d = ringPath(center, zoom, ring);
          if (!d) return null;
          return (
            <path
              key={`${featureIndex}-${ringIndex}`}
              d={d}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              vectorEffect="non-scaling-stroke"
            />
          );
        }),
      )}
    </svg>
  );
}

function overlayProperty(feature: SpatialOverlayFeature | undefined, keys: string[]) {
  if (!feature?.properties) return "";
  for (const key of keys) {
    const value = feature.properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function overlaySummary(features: SpatialOverlayFeature[], fallback: string) {
  if (features.length === 0) return fallback;
  const first = features[0];
  const name = overlayProperty(first, [
    "name",
    "NAME",
    "label",
    "region_name",
    "REG_NAME_7",
    "ibra_region",
    "kba_name",
    "KBA_NAME",
    "pa_name",
    "PA_NAME",
    "reserve_name",
    "RESNAME",
  ]);
  if (!name) return `${features.length} overlapping area${features.length === 1 ? "" : "s"} found`;
  if (features.length === 1) return name;
  return `${name} + ${features.length - 1} more`;
}

function overlayTakeaways({
  protectedAreaCount,
  bioregionCount,
  kbaCount,
}: {
  protectedAreaCount: number;
  bioregionCount: number;
  kbaCount: number;
}) {
  return [
    {
      label: "Protected areas",
      tone: "bg-emerald-500",
      text:
        protectedAreaCount > 0
          ? `${protectedAreaCount} protected-area overlap${protectedAreaCount === 1 ? "" : "s"} nearby. This can increase land-use scrutiny and conservation expectations.`
          : "No protected-area overlap found in the current search area.",
    },
    {
      label: "Bioregions",
      tone: "bg-sky-500",
      text:
        bioregionCount > 1
          ? `${bioregionCount} bioregions are present, so the site sits within a mixed ecological setting rather than one uniform landscape.`
          : bioregionCount === 1
            ? "One bioregion is present, giving the site a clear regional ecological context."
            : "No bioregion overlap was returned for the current search area.",
    },
    {
      label: "Key biodiversity areas",
      tone: "bg-blue-600",
      text:
        kbaCount > 0
          ? `${kbaCount} key biodiversity area overlap${kbaCount === 1 ? "" : "s"} found. These are higher-priority conservation signals worth reviewing early.`
          : "No key biodiversity area overlap found in the current search area.",
    },
  ];
}

function OverlayMetricCard({
  label,
  count,
  detail,
  tone,
  loading,
}: {
  label: string;
  count: number;
  detail: string;
  tone: "emerald" | "sky" | "blue";
  loading: boolean;
}) {
  const toneClasses = {
    emerald: "border-emerald-200 bg-emerald-50/80 text-emerald-700",
    sky: "border-sky-200 bg-sky-50/80 text-sky-700",
    blue: "border-blue-200 bg-blue-50/80 text-blue-700",
  };

  return (
    <div className={`min-w-0 rounded-xl border px-4 py-3 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[11px] font-semibold uppercase text-stone-500">
          {label}
        </span>
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-stone-950">
        {loading ? "..." : count}
      </div>
      <div className="mt-1 truncate text-[12px] text-stone-600" title={detail}>
        {loading ? "Checking database overlays" : detail}
      </div>
    </div>
  );
}

export function BiodiversityMap({
  site,
  layerA,
  loading,
  onOverlaySummaryChange,
  showOverview = true,
}: {
  site: SpatialSite;
  layerA?: SpatialLayerAResponse | null;
  loading?: boolean;
  onOverlaySummaryChange?: (summary: SpatialOverlaySummary) => void;
  showOverview?: boolean;
}) {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    ala: true,
    capad: true,
    ibra: true,
    kba: true,
    snes: false,
  });
  const [open, setOpen] = useState(false);
  const [overlays, setOverlays] = useState<SpatialOverlaysResponse | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: { x: number; y: number };
  } | null>(null);
  const targetZoomRef = useRef(zoomForRadius(site.radiusKm, site.lat));
  const zoomFrameRef = useRef<number | null>(null);
  const toggle = (k: LayerKey) => setLayers((s) => ({ ...s, [k]: !s[k] }));
  const companyName = layerA?.company?.legal_name || site.company;
  const postcode = locationPostcode(layerA);
  const state = locationState(layerA);
  const country = locationCountry(layerA);
  const queries = useMemo(() => {
    const full = [companyName, postcode, state, country].filter(Boolean).join(", ");
    const regional = [postcode, state, country].filter(Boolean).join(", ");
    return Array.from(new Set([full, regional].filter(Boolean)));
  }, [companyName, postcode, state, country]);
  const [mapPoint, setMapPoint] = useState<MapPoint>(() => fallbackPoint(site, layerA));
  const [viewCenter, setViewCenter] = useState<MapPoint>(() => fallbackPoint(site, layerA));
  const [zoom, setZoom] = useState(() => zoomForRadius(site.radiusKm, site.lat));
  const threatenedOccurrences = (layerA?.threatened_occurrences ?? [])
    .filter((occurrence) => Number.isFinite(occurrence.lat) && Number.isFinite(occurrence.lon))
    .slice(0, 120);
  const score = layerA?.species_threat_score ?? 0;
  const activeLayerCount = Object.values(layers).filter(Boolean).length;
  const tiles = useMemo(() => osmTiles(viewCenter, zoom), [viewCenter, zoom]);

  const scheduleZoomAnimation = () => {
    if (zoomFrameRef.current !== null) return;

    const animate = () => {
      zoomFrameRef.current = null;
      setZoom((current) => {
        const target = targetZoomRef.current;
        const next = current + (target - current) * 0.22;
        if (Math.abs(target - next) < 0.01) return target;
        zoomFrameRef.current = requestAnimationFrame(animate);
        return next;
      });
    };

    zoomFrameRef.current = requestAnimationFrame(animate);
  };

  const changeZoom = (delta: number) => {
    targetZoomRef.current = clamp(targetZoomRef.current + delta, 7, 16);
    scheduleZoomAnimation();
  };

  useEffect(() => {
    let cancelled = false;

    async function geocode() {
      for (const query of queries) {
        try {
          const params = new URLSearchParams({
            q: query,
            format: "jsonv2",
            limit: "1",
            countrycodes: country.toLowerCase() === "australia" ? "au" : "",
          });
          if (!params.get("countrycodes")) params.delete("countrycodes");

          const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) continue;

          const data = (await response.json()) as NominatimResult[];
          const first = data[0];
          if (!first) continue;

          const lat = Number(first.lat);
          const lon = Number(first.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          if (!cancelled) {
            const nextPoint = {
              lat,
              lon,
              label: first.display_name || query,
            };
            setMapPoint(nextPoint);
            setViewCenter(nextPoint);
          }
          return;
        } catch {
          // Try the next, less-specific query.
        }
      }

      if (!cancelled) {
        const nextPoint = fallbackPoint(site, layerA);
        setMapPoint(nextPoint);
        setViewCenter(nextPoint);
      }
    }

    void geocode();
    return () => {
      cancelled = true;
    };
  }, [country, layerA, queries, site]);

  useEffect(() => {
    const nextZoom = zoomForRadius(site.radiusKm, mapPoint.lat);
    targetZoomRef.current = nextZoom;
    if (zoomFrameRef.current !== null) {
      cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
    setZoom(nextZoom);
  }, [mapPoint.lat, site.radiusKm]);

  useEffect(() => () => {
    if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
  }, []);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const step = clamp(Math.abs(event.deltaY) / 520, 0.06, 0.22);
    changeZoom(event.deltaY < 0 ? step : -step);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: lonLatToWorld(viewCenter.lon, viewCenter.lat, zoom),
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setViewCenter(worldToLonLat(drag.startCenter.x - dx, drag.startCenter.y - dy, zoom));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    setOverlayError(null);
    setOverlayLoading(true);

    getSpatialOverlays({
      lat: mapPoint.lat,
      lon: mapPoint.lon,
      radius_km: site.radiusKm,
    })
      .then((data) => {
        if (!cancelled) setOverlays(data);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setOverlays(null);
          setOverlayError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setOverlayLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mapPoint.lat, mapPoint.lon, site.radiusKm]);

  const capadFeatures = overlays?.layers.capad?.features ?? [];
  const kbaFeatures = overlays?.layers.kba?.features ?? [];
  const ibraFeatures = overlays?.layers.ibra?.features ?? [];
  const protectedAreaLabel = overlayError ? "Overlay query unavailable" : overlaySummary(capadFeatures, "No protected area overlap");
  const bioregionLabel = overlayError ? "Overlay query unavailable" : overlaySummary(ibraFeatures, "No bioregion overlap");
  const kbaLabel = overlayError ? "Overlay query unavailable" : overlaySummary(kbaFeatures, "No key biodiversity overlap");
  const takeaways = overlayTakeaways({
    protectedAreaCount: capadFeatures.length,
    bioregionCount: ibraFeatures.length,
    kbaCount: kbaFeatures.length,
  });
  const sitePoint = projectLonLat(viewCenter, zoom, mapPoint.lon, mapPoint.lat);

  useEffect(() => {
    onOverlaySummaryChange?.({
      protectedAreaCount: capadFeatures.length,
      protectedAreaLabel,
      bioregionCount: ibraFeatures.length,
      bioregionLabel,
      kbaCount: kbaFeatures.length,
      kbaLabel,
      loading: overlayLoading,
      error: overlayError,
    });
  }, [
    capadFeatures.length,
    protectedAreaLabel,
    ibraFeatures.length,
    bioregionLabel,
    kbaFeatures.length,
    kbaLabel,
    overlayLoading,
    overlayError,
    onOverlaySummaryChange,
  ]);

  return (
    <div className="space-y-3">
      {showOverview && (
        <>
          <div data-tour="spatial-overlap-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <OverlayMetricCard
              label="Protected areas"
              count={capadFeatures.length}
              detail={protectedAreaLabel}
              tone="emerald"
              loading={overlayLoading}
            />
            <OverlayMetricCard
              label="Bioregions"
              count={ibraFeatures.length}
              detail={bioregionLabel}
              tone="sky"
              loading={overlayLoading}
            />
            <OverlayMetricCard
              label="Key biodiversity areas"
              count={kbaFeatures.length}
              detail={kbaLabel}
              tone="blue"
              loading={overlayLoading}
            />
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              What these signals suggest
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {takeaways.map((takeaway) => (
                <div key={takeaway.label} className="flex gap-2.5">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${takeaway.tone}`} />
                  <div>
                    <div className="text-[12px] font-medium text-stone-800">{takeaway.label}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-stone-600">
                      {overlayLoading
                        ? "Checking nearby spatial signals..."
                        : overlayError
                          ? "Spatial overlay takeaway unavailable right now."
                          : takeaway.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div
        data-tour="spatial-map"
        className="relative h-[360px] w-full touch-none overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-sm md:h-[420px] xl:h-[460px]"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
      <div className="absolute inset-0 bg-[#e9ece7]">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            className="absolute select-none"
            draggable={false}
            style={{
              left: tile.left,
              top: tile.top,
              width: tile.width,
              height: tile.height,
            }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-white/10" />

      {layers.ibra && ibraFeatures.length > 0 && (
        <OverlayPaths
          features={ibraFeatures}
          center={viewCenter}
          zoom={zoom}
          className="opacity-80"
          fill="rgba(14,165,233,0.10)"
          stroke="rgba(2,132,199,0.8)"
          strokeDasharray="7 5"
          strokeWidth={1.2}
        />
      )}

      {layers.capad && capadFeatures.length > 0 && (
        <OverlayPaths
          features={capadFeatures}
          center={viewCenter}
          zoom={zoom}
          className="opacity-90"
          fill="rgba(16,185,129,0.16)"
          stroke="rgba(4,120,87,0.92)"
          strokeWidth={1.25}
        />
      )}

      {/* SNES habitat heatmap */}
      {layers.snes && (
        <div
          className="pointer-events-none absolute opacity-80"
          style={{
            left: "38%",
            top: "30%",
            width: "32%",
            height: "40%",
            background:
              "radial-gradient(circle, rgba(244,63,94,0.28) 0%, rgba(244,63,94,0.12) 42%, rgba(244,63,94,0) 72%)",
            filter: "blur(6px)",
          }}
        />
      )}

      {layers.kba && kbaFeatures.length > 0 && (
        <OverlayPaths
          features={kbaFeatures}
          center={viewCenter}
          zoom={zoom}
          className="opacity-85"
          fill="rgba(37,99,235,0.12)"
          stroke="rgba(30,64,175,0.92)"
          strokeDasharray="4 3"
          strokeWidth={1.6}
        />
      )}

      {/* ALA threatened species occurrence points */}
      {layers.ala && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
          {threatenedOccurrences.map((occurrence, i) => {
            const point = projectOccurrence(viewCenter, zoom, occurrence);
            const r = occurrence.iucn_category === "CR" ? 4 : occurrence.iucn_category === "EN" ? 3.4 : 2.8;
            return (
              <circle
                key={`${occurrence.occurrence_id || occurrence.scientific_name}-${i}`}
                cx={point.x}
                cy={point.y}
                r={r}
                fill={occurrenceColor(occurrence.iucn_category)}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth="1"
              >
                <title>
                  {occurrence.scientific_name}
                  {occurrence.common_name ? ` (${occurrence.common_name})` : ""}
                  {occurrence.iucn_category ? ` - ${occurrence.iucn_category}` : ""}
                </title>
              </circle>
            );
          })}
        </svg>
      )}

      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(sitePoint.x / VIEW_W) * 100}%`, top: `${(sitePoint.y / VIEW_H) * 100}%` }}
      >
        <div className="flex size-9 items-center justify-center rounded-full bg-white/95 shadow-md ring-1 ring-emerald-200">
          <div className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-white">
            <MapPin className="size-3.5" />
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {overlayLoading && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-[12px] text-stone-600 shadow-sm ring-1 ring-stone-200">
            <Loader2 className="size-4 animate-spin text-emerald-700" />
            Loading spatial overlays
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute left-4 top-4 max-w-[calc(100%-6rem)] rounded-lg bg-white/95 px-3 py-2 text-[11px] text-stone-700 shadow-sm ring-1 ring-stone-200/80">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="size-3.5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-stone-900">
              {site.company}
            </div>
            <div className="truncate text-stone-500">
              {mapPoint.lat.toFixed(4)}, {mapPoint.lon.toFixed(4)} | {site.radiusKm} km radius | z{zoom.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-[76px] flex flex-wrap gap-1.5 rounded-lg bg-white/90 px-2.5 py-2 text-[10px] text-stone-600 shadow-sm ring-1 ring-stone-200/80">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Protected</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-blue-600" /> Key area</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-sky-500" /> Bioregion</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-rose-500" /> Threatened wildlife</span>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-[11px] text-stone-600 shadow-sm ring-1 ring-stone-200/80">
        <span className="text-stone-500">Nature score</span>
        <span className="font-mono text-stone-900">{loading ? "..." : `${score.toFixed(1)}/100`}</span>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all"
            style={{ width: `${Math.min(100, score)}%` }}
          />
        </div>
        <span>{threatenedOccurrences.length} occurrences</span>
        <span className="text-stone-300">|</span>
        <span>{layerA?.threatened_species_count ?? 0} CR/EN/VU species</span>
        {overlayError && (
          <>
            <span className="text-stone-300">|</span>
            <span className="text-amber-700">Spatial overlays unavailable</span>
          </>
        )}
      </div>

      {/* Map controls */}
      <div data-tour="spatial-map-layers" className="absolute right-4 top-4 flex flex-col items-end gap-2" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex overflow-hidden rounded-lg bg-white/95 ring-1 ring-stone-200/80 shadow-sm">
          <button
            type="button"
            onClick={() => changeZoom(0.8)}
            className="p-2 text-stone-600 hover:bg-stone-50"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus className="size-4" />
          </button>
          <div className="w-px bg-stone-200" />
          <button
            type="button"
            onClick={() => changeZoom(-0.8)}
            className="p-2 text-stone-600 hover:bg-stone-50"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setViewCenter(mapPoint)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-2 text-[11px] text-stone-600 shadow-sm ring-1 ring-stone-200/80 hover:bg-stone-50"
          title="Recenter map on the analysed location"
        >
          <Crosshair className="size-3.5 text-emerald-700" />
          Recenter
        </button>
        <div className="w-56 overflow-hidden rounded-lg bg-white/95 ring-1 ring-stone-200/80 shadow-sm">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] text-stone-700 hover:bg-stone-50"
          >
            <span className="flex items-center gap-2">
              <Layers className="size-3.5 text-emerald-600" />
              Map Layers
            </span>
            <span className="text-[10px] text-stone-400">
              {activeLayerCount}/5
            </span>
          </button>
          {open && (
            <div className="border-t border-stone-200 p-2">
              {layerConfig.map((l) => (
                <label
                  key={l.key}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] text-stone-700 hover:bg-stone-50"
                >
                  <span className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-sm ${l.swatch}`} />
                    {l.label}
                    {l.key === "capad" && <span className="text-[10px] text-stone-400">{capadFeatures.length}</span>}
                    {l.key === "kba" && <span className="text-[10px] text-stone-400">{kbaFeatures.length}</span>}
                    {l.key === "ibra" && <span className="text-[10px] text-stone-400">{ibraFeatures.length}</span>}
                    {l.key === "ala" && <span className="text-[10px] text-stone-400">{threatenedOccurrences.length}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(l.key)}
                    className={`relative h-4 w-7 rounded-full transition ${
                      layers[l.key] ? "bg-emerald-500" : "bg-stone-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-3 rounded-full bg-white transition shadow ${
                        layers[l.key] ? "left-3.5" : "left-0.5"
                      }`}
                    />
                  </button>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
