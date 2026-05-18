import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPin, Minus, Plus } from 'lucide-react';
import type { RiskLevel } from './shared';

export type WatchlistMapMarker = {
  id: string;
  label: string;
  subtitle?: string;
  lat: number;
  lon: number;
  riskScore?: number | null;
  riskLevel: RiskLevel;
};

type MapPoint = {
  lat: number;
  lon: number;
};

const VIEW_W = 800;
const VIEW_H = 420;
const TILE_SIZE = 256;
const AUSTRALIA_CENTER = { lat: -25.2744, lon: 133.7751 };

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
  };
}

function projectLonLat(center: MapPoint, zoom: number, lon: number, lat: number) {
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom);
  const pointWorld = lonLatToWorld(lon, lat, zoom);
  return {
    x: VIEW_W / 2 + pointWorld.x - centerWorld.x,
    y: VIEW_H / 2 + pointWorld.y - centerWorld.y,
  };
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
      tiles.push({
        key: `${tileZoom}-${x}-${y}`,
        url: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${y}.png`,
        left: `${(((x * TILE_SIZE - topLeft.x) * tileScale) / VIEW_W) * 100}%`,
        top: `${(((y * TILE_SIZE - topLeft.y) * tileScale) / VIEW_H) * 100}%`,
        width: `${((TILE_SIZE * tileScale) / VIEW_W) * 100}%`,
        height: `${((TILE_SIZE * tileScale) / VIEW_H) * 100}%`,
      });
    }
  }

  return tiles;
}

function markerTone(level: RiskLevel) {
  if (level === 'Critical') return 'bg-rose-700 ring-rose-200';
  if (level === 'High') return 'bg-orange-600 ring-orange-200';
  if (level === 'Medium') return 'bg-amber-500 ring-amber-200';
  return 'bg-emerald-600 ring-emerald-200';
}

function averageCenter(markers: WatchlistMapMarker[]): MapPoint {
  if (markers.length === 0) return AUSTRALIA_CENTER;
  return {
    lat: markers.reduce((total, marker) => total + marker.lat, 0) / markers.length,
    lon: markers.reduce((total, marker) => total + marker.lon, 0) / markers.length,
  };
}

export function WatchlistMap({
  markers,
  selectedId,
  onSelect,
}: {
  markers: WatchlistMapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const selectedMarker = markers.find((marker) => marker.id === selectedId);
  const homeCenter = selectedMarker ?? averageCenter(markers);
  const [viewCenter, setViewCenter] = useState<MapPoint>(homeCenter);
  const [zoom, setZoom] = useState(markers.length > 1 && !selectedMarker ? 4 : 7);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: { x: number; y: number };
  } | null>(null);
  const tiles = useMemo(() => osmTiles(viewCenter, zoom), [viewCenter, zoom]);

  useEffect(() => {
    setViewCenter(homeCenter);
    setZoom(markers.length > 1 && !selectedMarker ? 4 : 7);
  }, [homeCenter.lat, homeCenter.lon, markers.length, selectedMarker]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((value) => clamp(value + (event.deltaY < 0 ? 0.35 : -0.35), 3, 16));
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
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className="relative h-[360px] touch-none overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-sm"
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

      {markers.map((marker) => {
        const point = projectLonLat(viewCenter, zoom, marker.lon, marker.lat);
        const selected = marker.id === selectedId;
        return (
          <button
            key={marker.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(marker.id);
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(point.x / VIEW_W) * 100}%`, top: `${(point.y / VIEW_H) * 100}%` }}
            title={marker.label}
          >
            <span
              className={`flex items-center justify-center rounded-full text-white shadow-lg ring-4 transition ${
                selected ? 'size-10' : 'size-8'
              } ${markerTone(marker.riskLevel)}`}
            >
              <MapPin className={selected ? 'size-5' : 'size-4'} />
            </span>
          </button>
        );
      })}

      <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/95 px-3 py-2 shadow-sm ring-1 ring-stone-200">
        <div className="text-[12px] font-semibold text-stone-950">Portfolio locations</div>
        <div className="mt-0.5 text-[11px] text-stone-500">
          {markers.length} mapped {markers.length === 1 ? 'company' : 'companies'}
        </div>
      </div>

      {selectedMarker && (
        <div className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-2rem)] rounded-xl bg-white/95 px-3 py-2 shadow-sm ring-1 ring-stone-200">
          <div className="text-[12px] font-semibold text-stone-950">{selectedMarker.label}</div>
          <div className="mt-0.5 text-[11px] text-stone-500">
            {selectedMarker.subtitle || `${selectedMarker.lat.toFixed(4)}, ${selectedMarker.lon.toFixed(4)}`}
          </div>
        </div>
      )}

      {markers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl bg-white/95 px-4 py-3 text-center shadow-sm ring-1 ring-stone-200">
            <div className="text-[13px] font-semibold text-stone-950">No saved site locations yet</div>
            <div className="mt-1 text-[12px] leading-relaxed text-stone-600">
              Re-run analysis for a watched company to save a mapped location into the watchlist.
            </div>
          </div>
        </div>
      )}

      <div className="absolute right-4 top-4 flex flex-col gap-2" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex overflow-hidden rounded-xl bg-white/95 shadow-sm ring-1 ring-stone-200">
          <button
            type="button"
            onClick={() => setZoom((value) => clamp(value + 0.8, 3, 16))}
            className="p-2 text-stone-700 hover:bg-stone-50"
            title="Zoom in"
          >
            <Plus className="size-4" />
          </button>
          <div className="w-px bg-stone-200" />
          <button
            type="button"
            onClick={() => setZoom((value) => clamp(value - 0.8, 3, 16))}
            className="p-2 text-stone-700 hover:bg-stone-50"
            title="Zoom out"
          >
            <Minus className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setViewCenter(homeCenter);
            setZoom(markers.length > 1 && !selectedMarker ? 4 : 7);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/95 px-2.5 py-2 text-[11px] text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
        >
          <Crosshair className="size-3.5 text-emerald-700" />
          Recenter
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 rounded-lg bg-white/90 px-2 py-1 text-[10px] text-stone-500 shadow-sm ring-1 ring-stone-200">
        Map data © OpenStreetMap contributors
      </div>
    </div>
  );
}
