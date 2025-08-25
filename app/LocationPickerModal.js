'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const PinIcon = L.icon({
  iconUrl: '/foodtruck-marker.png',
  iconSize: [42, 42],
  iconAnchor: [21, 40],
  popupAnchor: [0, -36],
});

function ClickToSet({ onSet }) {
  useMapEvents({
    click(e) {
      onSet({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FlyToOnChange({ center, zoom = 16 }) {
  const map = useMap();
  useEffect(() => {
    if (!center?.lat || !center?.lng) return;
    map.flyTo([center.lat, center.lng], zoom, { animate: true, duration: 0.5 });
  }, [center?.lat, center?.lng, zoom, map]);
  return null;
}


export default function LocationPickerModal({
  open,
  onClose,
  onConfirm, // ({lat, lng})
  initialCenter = { lat: 59.3293, lng: 18.0686 }, // fallback: Stockholm
  storageKey,
}) {
  const [center, setCenter] = useState(initialCenter);
  const [marker, setMarker] = useState(initialCenter);
  const [prefilled, setPrefilled] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const mapRef = useRef(null);

useEffect(() => {
  if (!open || !storageKey) return;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const { lat, lng } = JSON.parse(raw);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const p = { lat, lng };
        setCenter(p);
        setMarker(p);
        setPrefilled(true); // <— viktigt
      }
    }
  } catch {}
}, [open, storageKey]);

useEffect(() => {
  if (!open || prefilled) return;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCenter({ lat, lng });
        setMarker({ lat, lng });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}, [open, prefilled]);

  if (!open) return null;

  const geocode = async () => {
    const q = query.trim();
    if (!q) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {}
  };

  const pickResult = (r) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setCenter({ lat, lng });
    setMarker({ lat, lng });
    try { mapRef.current?.setView([lat, lng], 16, { animate: true }); } catch {}
    setResults([]);
  };

  return (
    <div className="fixed inset-0 z-[2000]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[95%] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl border overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-semibold">Välj plats för din truck</div>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Stäng</button>
        </div>

        {/* Sök */}
        <div className="p-3 border-b">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök adress, plats…"
              className="flex-1 rounded-xl border px-3 py-2"
            />
            <button onClick={geocode} className="rounded-xl bg-gray-900 text-white px-3 py-2 text-sm">Sök</button>
          </div>
          {results.length > 0 && (
            <div className="mt-2 max-h-40 overflow-auto border rounded-lg">
              {results.map((r, i) => (
                <button key={i} onClick={() => pickResult(r)} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Karta */}
        <div className="h-[360px] relative">
<MapContainer
  center={[center.lat, center.lng]}
  zoom={15}
  style={{ height: '100%', width: '100%' }}
  whenCreated={(m) => (mapRef.current = m)}
>
  <TileLayer
    attribution='&copy; OpenStreetMap, &copy; CARTO'
    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
  />

  {/* NYTT: flytta kartan när center ändras */}
  <FlyToOnChange center={center} zoom={16} />

  <ClickToSet onSet={(p) => { setMarker(p); setCenter(p); }} />
  <Marker
    position={[marker.lat, marker.lng]}
    icon={PinIcon}
    draggable
    eventHandlers={{
      dragend: (e) => {
        const p = e.target.getLatLng();
        setMarker({ lat: p.lat, lng: p.lng });
      },
    }}
  />
</MapContainer>

          <div className="absolute left-3 bottom-3 bg-white/95 border rounded-lg shadow px-3 py-1.5 text-xs">
            Lat: {marker.lat.toFixed(6)} • Lng: {marker.lng.toFixed(6)}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">Avbryt</button>
<button
  onClick={() => {
    try {
      if (storageKey) {
        localStorage.setItem(storageKey, JSON.stringify({ lat: marker.lat, lng: marker.lng }));
      }
    } catch {}
    onConfirm?.({ lat: marker.lat, lng: marker.lng });
  }}
  className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm"
>
  Använd denna plats
</button>
        </div>
      </div>
    </div>
  );
}
