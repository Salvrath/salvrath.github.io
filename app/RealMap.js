'use client';

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// Standard ikonfix (Leaflet default-ikoner i Next)
const DefaultIcon = L.icon({
  iconUrl: '/foodtruck-marker.png',
  iconSize: [42, 42],
  iconAnchor: [21, 40],
  popupAnchor: [0, -36],
});
const livePulseIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#10b981;box-shadow:0 0 0 8px rgba(16,185,129,0.25);border:2px solid white"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -9],
});

function FlyToOnCenterChange({ center, zoom, mapRef }) {
  const map = useMap();
  useEffect(() => {
    if (!center || !Array.isArray(center)) return;
    map.flyTo(center, zoom, { duration: 0.5 });
  }, [center, zoom, map]);
  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);
  return null;
}

function ClickToClosePopups() {
  useMapEvents({
    click() {
      // Leaflet stänger popups automatiskt; inget extra behövs här
    },
  });
  return null;
}

export default function RealMap({
  center,
  zoom,
  trucks,
  onTruckClick,
  renderTruckPopupContent,
  livePulsePositions = [],
  liveCheckins = [],
  onCheckIn,
  onCheckOut,
  liveCheckinActive,
  isAdmin,
  isLoggedIn,
  hasDefaultTruck,
  onLogout,
  onGoMyTruck,
  onGoAdmin,
  onOpenTruck,
}) {
  const mapRef = useRef(null);

  // Hjälper marker-klick att alltid animera kartan
  const flyToTruck = (pos) => {
    const map = mapRef.current;
    if (!map || !Array.isArray(pos)) return;
    map.flyTo(pos, Math.max(16, map.getZoom() || 16), { duration: 0.5 });
  };

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={center}
        zoom={zoom}
        className="z-0"
        style={{ height: '100%', width: '100%' }}
        whenCreated={(m) => { mapRef.current = m; }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap, &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <FlyToOnCenterChange center={center} zoom={zoom} mapRef={mapRef} />
        <ClickToClosePopups />


        {/* Truck-markers */}
        {trucks.map((t) => (
          <Marker
            key={`t-${t.id}`}
            position={t.position}
            icon={DefaultIcon}
            opacity={t.isLive ? 1 : 0.8}
            eventHandlers={{
              click: () => {
                onTruckClick && onTruckClick(t);
                flyToTruck(t.position);
              },
            }}
          >
            <Popup className="text-base" maxWidth={320}>
              {renderTruckPopupContent ? renderTruckPopupContent(t) : <div>{t.name}</div>}
            </Popup>
          </Marker>
        ))}

        {/* Pulser för live-trucks */}
        {livePulsePositions.map((pos, i) => (
          <Marker key={`pulse-${i}`} position={pos} icon={livePulseIcon} />
        ))}

        {/* Aktiva checkins (debug/info) */}
        {liveCheckins.map((c) => (
          <Marker key={`live-${c.id}`} position={[c.lat, c.lng]} icon={livePulseIcon}>
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">Live: incheckad</div>
                <div>⏱️ {new Date(c.started_at).toLocaleTimeString()}</div>
                {c.truck_id ? <div>Truck: {c.truck_id}</div> : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

{/* Knapprad – uppe till höger (smal wrapper som inte täcker vänstersidan) */}
<div className="pointer-events-none fixed right-3 top-3 z-[1200] flex items-center gap-2">
  <div className="pointer-events-auto flex items-center gap-2 bg-white/95 border rounded-xl shadow px-2 py-1">
    {/* Öppna/Stäng truck */}
    <button
      type="button"
      onClick={liveCheckinActive ? onCheckOut : onCheckIn}
      className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
        liveCheckinActive ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
      }`}
      title={liveCheckinActive ? 'Stäng truck' : 'Öppna truck'}
    >
      {liveCheckinActive ? '⏹ Stäng truck' : '✅ Öppna truck'}
    </button>

    {/* Min truck */}
    <button
      type="button"
      onClick={onGoMyTruck}
      className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm"
      title="Min foodtruck"
    >
      🚚 Min truck
    </button>

    {/* Admin – bara om admin */}
    {isAdmin && (
      <button
        type="button"
        onClick={onGoAdmin}
        className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm"
        title="Admin"
      >
        🔑 Admin
      </button>
    )}
  </div>
</div>


    </div>
  );
}
