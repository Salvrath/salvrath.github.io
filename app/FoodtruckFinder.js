'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';

// Lazy-laddade klientkomponenter
const LocationPickerModal = dynamic(() => import('./LocationPickerModal'), { ssr: false });
const RealMap = dynamic(() => import('./RealMap'), { ssr: false });

/* ================= Helpers ================= */
function isValidLatLng(pos) {
  return Array.isArray(pos)
    && pos.length === 2
    && typeof pos[0] === 'number'
    && typeof pos[1] === 'number'
    && pos[0] >= -90 && pos[0] <= 90
    && pos[1] >= -180 && pos[1] <= 180;
}
const toMinutes = (hm) => { const [h, m] = (hm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fromMinutes = (mins) => {
  const m = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
function isOpenNow(range, now = new Date()) {
  if (!range?.includes('-')) return false;
  const [s, e] = range.split('-').map((s) => s.trim());
  const cur = now.getHours() * 60 + now.getMinutes();
  const S = toMinutes(s), E = toMinutes(e);
  return E > S ? cur >= S && cur <= E : cur >= S || cur <= E;
}
function opensLaterToday(range, now = new Date()) {
  if (!range?.includes('-')) return null;
  const [s, e] = range.split('-').map((s) => s.trim());
  const cur = now.getHours() * 60 + now.getMinutes();
  const S = toMinutes(s), E = toMinutes(e);
  if (E > S) return cur < S ? s : null;
  if (cur <= E) return null;
  if (cur < S) return s;
  return null;
}
function getClosingFromRange(range, now = new Date()) {
  if (!range?.includes('-')) return null;
  const [s, e] = range.split('-').map(v => v.trim());
  const S = toMinutes(s), E = toMinutes(e);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (E > S) {
    if (cur >= S && cur <= E) return e;
  } else {
    if (cur >= S || cur <= E) return e;
  }
  return null;
}
function haversineKm([a, b], [c, d]) {
  const R = 6371;
  const dLat = (c - a) * Math.PI / 180;
  const dLon = (d - b) * Math.PI / 180;
  const A = Math.sin(dLat / 2) ** 2
    + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}
function etaMinutesKm(distanceKm, mode = 'walk') {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const speedKmh = mode === 'drive' ? 20 : 4.8;
  const mins = (distanceKm / speedKmh) * 60;
  return Math.max(1, Math.round(mins));
}

// schedule_json helpers
const DAYS_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
const DAYS_SV   = ['sön','mån','tis','ons','tor','fre','lör'];
function normalizeSlotsForDay(schedule, dayIdx) {
  if (!schedule || typeof schedule !== 'object') return [];
  const key = DAYS_KEYS[dayIdx];
  const slots = schedule[key] || schedule[key?.toUpperCase()]
    || schedule[key?.charAt(0).toUpperCase() + key?.slice(1)] || [];
  const arr = Array.isArray(slots) ? slots : [];
  return arr.map(s => {
    if (!s) return null;
    if (typeof s === 'string') {
      const m = s.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!m) return null;
      return { startMin: toMinutes(m[1]), endMin: toMinutes(m[2]) };
    }
    if (typeof s === 'object' && s.start && s.end) {
      return { startMin: toMinutes(s.start), endMin: toMinutes(s.end) };
    }
    return null;
  }).filter(Boolean);
}
function isOpenNowFromSchedule(schedule, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const slots = normalizeSlotsForDay(schedule, now.getDay());
  for (const { startMin, endMin } of slots) {
    if (endMin > startMin) {
      if (cur >= startMin && cur <= endMin) return true;
    } else {
      if (cur >= startMin || cur <= endMin) return true;
    }
  }
  return false;
}
function getNextOpeningFromSchedule(schedule, now = new Date()) {
  if (!schedule || typeof schedule !== 'object') return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  const todaySlots = normalizeSlotsForDay(schedule, today).sort((a,b)=>a.startMin-b.startMin);
  for (const { startMin } of todaySlots) {
    if (cur < startMin) return { dayOffset: 0, label: fromMinutes(startMin) };
  }
  for (let i = 1; i <= 7; i++) {
    const di = (today + i) % 7;
    const slots = normalizeSlotsForDay(schedule, di).sort((a,b)=>a.startMin-b.startMin);
    if (slots.length > 0) return { dayOffset: i, label: `${DAYS_SV[di]} ${fromMinutes(slots[0].startMin)}` };
  }
  return null;
}
function getCurrentClosingFromSchedule(schedule, now = new Date()) {
  if (!schedule || typeof schedule !== 'object') return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  const todayIdx = now.getDay();
  const today = normalizeSlotsForDay(schedule, todayIdx);
  for (const { startMin, endMin } of today) {
    if (endMin > startMin) {
      if (cur >= startMin && cur <= endMin) return fromMinutes(endMin);
    } else {
      if (cur >= startMin) return fromMinutes(endMin);
    }
  }
  // natt-spill från igår
  const yIdx = (todayIdx + 6) % 7;
  const y = normalizeSlotsForDay(schedule, yIdx);
  for (const { startMin, endMin } of y) {
    if (endMin < startMin) {
      if (cur <= endMin) return fromMinutes(endMin);
    }
  }
  return null;
}
function statusLabel(truck, now = new Date()) {
  if (truck?.isLive) return '⏰ Öppen nu • Live';
  if (truck?.open) {
    if (isOpenNow(truck.open, now)) {
      const close = getClosingFromRange(truck.open, now);
      return `⏰ Öppen nu${close ? ` • Stänger ${close}` : ''}`;
    }
    const next = opensLaterToday(truck.open, now);
    return next ? `⏰ Öppnar ${next}` : '⏰ Stängd just nu';
  }
  if (typeof truck?.openStatus === 'boolean') {
    if (truck.openStatus) {
      return `⏰ Öppen nu${truck.closingLabel ? ` • Stänger ${truck.closingLabel}` : ''}`;
    }
    return truck.nextOpenLabel ? `⏰ Öppnar ${truck.nextOpenLabel}` : '⏰ Stängd just nu';
  }
  return '';
}

/* ================= Component ================= */
export default function FoodtruckFinder() {
  // Demo-seed (visas tillsammans med DB)
  const [foodtrucks] = useState([
    { id: 1, name: 'Taco Truck', type: 'Mexican', position: [59.3293, 18.0686], open: '11:00 - 20:00', price: '$$', menu: 'Tacos, Burritos, Nachos', rating: 4.6, isLive: true },
    { id: 2, name: 'Burger Bus', type: 'American', position: [59.335, 18.07], open: '12:00 - 22:00', price: '$$', menu: 'Burgare, Fries, Milkshakes', rating: 4.4, isLive: true },
    { id: 3, name: 'Green Bowl', type: 'Vegan', position: [59.327, 18.075], open: '10:00 - 16:00', price: '$', menu: 'Vegansk bowls, smoothies', rating: 4.8, isLive: true },
    { id: 4, name: 'Late Night Noodles', type: 'Asian', position: [59.338, 18.06], open: '18:00 - 02:00', price: '$$$', menu: 'Ramen, Wok, Dumplings', rating: 4.3, isLive: true },
  ]);

  // Karta / position
  const [mapCenter, setMapCenter] = useState([59.3293, 18.0686]);
  const [zoom, setZoom] = useState(13);
  const [userPos, setUserPos] = useState([59.3293, 18.0686]); // för distans/ETA

  // Filter / UI
  const [filterType, setFilterType] = useState('All');
  const [query, setQuery] = useState('');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [sortBy, setSortBy] = useState('distance');
  const [etaMode, setEtaMode] = useState('walk');
  const [selected, setSelected] = useState(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Supabase
  const supabaseRef = useRef(null);
  const [ownerSession, setOwnerSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // DB + live
  const [selectedTruckId, setSelectedTruckId] = useState('');
  const [liveCheckins, setLiveCheckins] = useState([]);
  const [dbTrucks, setDbTrucks] = useState([]);
  const [liveCheckin, setLiveCheckin] = useState(null);
  const [statsByTruck, setStatsByTruck] = useState({});

  // Recensioner (per vald DB-truck)
  const [reviews, setReviews] = useState([]);
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Favoriter
  const [favIds, setFavIds] = useState(() => {
    try { return JSON.parse(typeof window !== 'undefined' ? (localStorage.getItem('ftf_favs') || '[]') : '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('ftf_favs', JSON.stringify(favIds)); } catch {} }, [favIds]);
  const toggleFavorite = (id) => setFavIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // hämta geolocation för userPos (för distans)
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(coords);
        setMapCenter(coords);
      });
    }
  }, []);

  // spara/återställ standardtruck (sanerat id)
  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('ftf_owner_truck_id') : '';
      if (stored && stored.trim()) {
        const id = stored.trim();
        setSelectedTruckId(id);
        localStorage.setItem('ftf_owner_truck_id', id);
      } else {
        setSelectedTruckId('');
        localStorage.removeItem('ftf_owner_truck_id');
      }
    } catch {}
  }, []);

  // Supabase init
  useEffect(() => {
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const { createClient } = await import('@supabase/supabase-js');
      const supa = createClient(url, key);
      supabaseRef.current = supa;

      const { data } = await supa.auth.getSession();
      setOwnerSession(data?.session || null);
      supa.auth.onAuthStateChange((_e, s) => setOwnerSession(s));

      const user = (await supa.auth.getUser())?.data?.user;
      if (user?.id) {
        try {
          const { data: isA } = await supa.rpc('is_admin', { uid: user.id });
          setIsAdmin(!!isA);
        } catch { setIsAdmin(false); }
      }

      async function refetchActive() {
        const { data } = await supa
          .from('checkins')
          .select('id,truck_id,lat,lng,started_at,ended_at')
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(500);
        setLiveCheckins(Array.isArray(data) ? data : []);
      }
      async function fetchDbTrucks() {
        const { data } = await supa
          .from('trucks')
          .select('id,name,type,last_seen_lat,last_seen_lng,last_seen_at,logo_url,schedule_json');
        setDbTrucks(Array.isArray(data) ? data : []);
      }
      async function fetchReviewStats() {
        const { data } = await supa.from('reviews_stats').select('truck_id,avg_rating,review_count');
        if (Array.isArray(data)) {
          const map = {};
          data.forEach((r) => { map[r.truck_id] = { avg_rating: r.avg_rating, review_count: r.review_count }; });
          setStatsByTruck(map);
        }
      }

      await Promise.all([refetchActive(), fetchDbTrucks(), fetchReviewStats()]);

      const ch1 = supa.channel('rt:checkins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => { refetchActive(); fetchDbTrucks(); })
        .subscribe();
      const ch2 = supa.channel('rt:reviews')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => fetchReviewStats())
        .subscribe();

      return () => {
        try { supa.removeChannel(ch1); } catch {}
        try { supa.removeChannel(ch2); } catch {}
      };
    })();
  }, []);

  // Logout
  const handleLogout = async () => {
    try {
      await supabaseRef.current?.auth.signOut();
      setOwnerSession(null);
    } catch (e) {
      console.error(e);
    }
  };

  // Aktiv check-in för vald truck
  useEffect(() => {
    if (!selectedTruckId) { setLiveCheckin(null); return; }
    const cur = liveCheckins.find(c => String(c.truck_id) === String(selectedTruckId) && !c.ended_at);
    setLiveCheckin(cur || null);
  }, [liveCheckins, selectedTruckId]);

  // Geocoding (REN funktion) + debounce
  const geocode = useCallback(async (q) => {
    const val = (q || '').trim();
    if (!val) return;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
          'User-Agent': 'FoodtruckFinder/1.0 (+kontakt@dindomän.se)',
        },
      });
      if (!res.ok) throw new Error(`Geocode ${res.status}`);
      const data = await res.json();
      setPlaceResults(Array.isArray(data) ? data : []);
      if (data?.[0]) {
        const lat = +data[0].lat, lon = +data[0].lon;
        if (Number.isFinite(lat) && Number.isFinite(lon)) { setMapCenter([lat, lon]); setZoom(14); }
      }
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => {
    const val = placeQuery.trim();
    if (val.length < 3) { setPlaceResults([]); return; }
    const id = setTimeout(() => geocode(val), 350);
    return () => clearTimeout(id);
  }, [placeQuery, geocode]);

  // Öppna / Stäng truck (via picker → checkin)
  const checkInHere = async (coordsFromPicker = null) => {
    const supa = supabaseRef.current;
    if (!supa) return alert('Supabase saknas');

    const raw = selectedTruckId || (typeof window !== 'undefined' ? localStorage.getItem('ftf_owner_truck_id') : '');
    const truckId = raw ? String(raw).trim() : '';
    if (!truckId) return alert('Ingen standardtruck vald. Välj en på /mytruck.');

    // Förhindra dubbel-incheckning
    const already = liveCheckins.find(c => String(c.truck_id) === String(truckId) && !c.ended_at);
    if (already) { alert('Trucken är redan öppnad.'); return; }

    const doInsert = async (lat, lng) => {
      const now = new Date().toISOString();
      const { data, error } = await supa
        .from('checkins')
        .insert({ truck_id: truckId, lat, lng, started_at: now })
        .select('*')
        .single();
      if (error) return alert(error.message);

      setLiveCheckins(prev => [data, ...prev]);
      await supa.from('trucks').update({ last_seen_lat: lat, last_seen_lng: lng, last_seen_at: now }).eq('id', truckId);
    };

    // Koordinater från pickern → använd exakt punkt
    if (coordsFromPicker?.lat && coordsFromPicker?.lng) {
      await doInsert(coordsFromPicker.lat, coordsFromPicker.lng);
      return;
    }

    // Fallback: GPS
    if (!navigator.geolocation) return alert('Geolocation saknas i din webbläsare.');
    navigator.geolocation.getCurrentPosition(
      (pos) => doInsert(pos.coords.latitude, pos.coords.longitude),
      (err) => alert(err?.message || 'Kunde inte hämta position.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const checkOut = async () => {
    if (!supabaseRef.current) return;
    let truckId = selectedTruckId || (typeof window !== 'undefined' ? localStorage.getItem('ftf_owner_truck_id') : '');
    truckId = truckId ? String(truckId).trim() : '';

    if (!truckId) { alert('Ingen standardtruck vald. Välj en på /mytruck.'); return; }

    const current = liveCheckins.find(c => String(c.truck_id) === truckId && !c.ended_at);
    if (!current) { alert('Ingen aktiv incheckning hittades.'); return; }

    const endedAt = new Date().toISOString();
    const { error } = await supabaseRef.current
      .from('checkins')
      .update({ ended_at: endedAt })
      .eq('id', current.id);

    if (error) return alert(error.message);

    setLiveCheckins(prev => prev.map(c => c.id === current.id ? { ...c, ended_at: endedAt } : c));
  };

  // Klick på truck i listan: centrera + markera
  const handleSelectTruck = (t) => {
    if (isValidLatLng(t.position)) {
      setMapCenter(t.position);
      setZoom((z) => Math.max(16, z));
    }
    setSelected(isValidLatLng(t.position) ? t : null);
  };

  // Mappa DB-trucks
  const supaMapped = useMemo(() => {
    return dbTrucks.map((t) => {
      const activeAny = liveCheckins.find(c => String(c.truck_id) === String(t.id) && !c.ended_at);
      const activeWithPos = liveCheckins.find(c =>
        String(c.truck_id) === String(t.id) && !c.ended_at && Number.isFinite(c.lat) && Number.isFinite(c.lng)
      );
      const lastValid = (Number.isFinite(t.last_seen_lat) && Number.isFinite(t.last_seen_lng))
        ? [t.last_seen_lat, t.last_seen_lng]
        : null;

      const stat = statsByTruck[t.id] || {};
      const openStatus = isOpenNowFromSchedule(t.schedule_json);
      const next = openStatus ? null : getNextOpeningFromSchedule(t.schedule_json);
      const closingLabel = openStatus ? getCurrentClosingFromSchedule(t.schedule_json) : null;

      return {
        id: `db-${t.id}`,
        dbId: t.id,
        name: t.name,
        type: t.type || '—',
        position: activeWithPos ? [activeWithPos.lat, activeWithPos.lng] : lastValid,
        isLive: !!activeAny,
        lastSeenAt: t.last_seen_at || null,

        open: null, // strängschema ej från DB, vi använder schedule_json
        openStatus,
        nextOpenLabel: next ? next.label : null,
        closingLabel,

        price: '—',
        menu: '',
        rating: stat.avg_rating || 0,
        reviewCount: stat.review_count || 0,
        logo_url: t.logo_url || null,
      };
    });
  }, [dbTrucks, liveCheckins, statsByTruck]);

  // Slå ihop, filtrera, distans, sortera
  const filteredTrucks = useMemo(() => {
    let base = [
      ...foodtrucks,
      ...supaMapped,
    ];

    if (filterType !== 'All') base = base.filter((t) => (t.type || '—') === filterType);

    if (openNowOnly) {
      base = base.filter((t) => {
        if (t.isLive) return true;
        if (t.open) return isOpenNow(t.open);
        if (typeof t.openStatus === 'boolean') return t.openStatus;
        return false;
      });
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      base = base.filter((t) =>
        (t.name || '').toLowerCase().includes(q)
        || (t.menu || '').toLowerCase().includes(q)
        || (t.type || '').toLowerCase().includes(q)
      );
    }

    const withDist = base.map((t) => {
      const dist = isValidLatLng(t.position) ? haversineKm(userPos, t.position) : Infinity;
      return {
        ...t,
        _dist: dist,
        _etaMins: Number.isFinite(dist) ? etaMinutesKm(dist, etaMode) : null,
      };
    });

    if (sortBy === 'rating') {
      base = withDist.filter(t => t.isLive || t._dist <= 10);
    } else {
      base = withDist;
    }

    if (sortBy === 'distance') base.sort((a,b) => (a._dist ?? Infinity) - (b._dist ?? Infinity));
    if (sortBy === 'rating')  base.sort((a,b) => ((b.rating||0) - (a.rating||0)) || ((a._dist??Infinity)-(b._dist??Infinity)));
    if (sortBy === 'alpha')   base.sort((a,b) => (a.name||'').localeCompare(b.name||'') || ((a._dist??Infinity)-(b._dist??Infinity)));

    return base;
  }, [foodtrucks, supaMapped, filterType, openNowOnly, query, sortBy, userPos, etaMode]);

  // Typer till chippar (inkl. DB)
  const types = useMemo(() => {
    const set = new Set(['All']);
    [...foodtrucks, ...dbTrucks].forEach(t => set.add(t.type || '—'));
    return [...set];
  }, [foodtrucks, dbTrucks]);

  /* ===== Recensioner: hämta när vald DB-truck ändras ===== */
  const fetchReviewsForSelected = useCallback(async () => {
    const supa = supabaseRef.current;
    if (!supa) return;
    const dbId = selected?.dbId;
    if (!dbId) { setReviews([]); return; }
    try {
      const { data, error } = await supa
        .from('reviews')
        .select('id,truck_id,user_email,comment,rating,created_at')
        .eq('truck_id', dbId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setReviews(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Reviews load error', e);
      setReviews([]);
    }
  }, [selected?.dbId]);
  useEffect(() => { fetchReviewsForSelected(); }, [fetchReviewsForSelected]);

  const submitReview = async () => {
    if (!supabaseRef.current) return alert('Supabase saknas.');
    if (!selected?.dbId) return alert('Kan bara recensera riktiga trucks.');
    const rating = Number(revRating);
    const comment = revComment.trim();
    if (!rating || rating < 1 || rating > 5) return alert('Välj betyg 1–5.');
    if (!comment) return alert('Skriv en kort kommentar.');

    setSubmittingReview(true);
    try {
      const email = ownerSession?.user?.email || null;
      const { data, error } = await supabaseRef.current
        .from('reviews')
        .insert({
          truck_id: selected.dbId,
          rating,
          comment,
          user_email: email
        })
        .select('id,truck_id,user_email,comment,rating,created_at')
        .single();

      if (error) throw error;

      setRevRating(5);
      setRevComment('');
      setReviews(prev => [data, ...prev]);

      // stats uppdateras via realtime → fetchReviewStats listener
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Kunde inte spara recensionen.');
    } finally {
      setSubmittingReview(false);
    }
  };

/* ==== Snyggare stjärnor ==== */
function StarIcon({ fillPct = 0, size = 18 }) {
  // fillPct: 0..1  (0=tom, 1=full)
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      {/* Bas: grå kontur */}
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 text-gray-300"
        width={size}
        height={size}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        />
      </svg>

      {/* Guld-fyllning: klipps av med overflow/width */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${Math.max(0, Math.min(1, fillPct)) * 100}%` }}
      >
        <svg
          viewBox="0 0 24 24"
          className="absolute inset-0 text-amber-500 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
          width={size}
          height={size}
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
          />
        </svg>
      </div>
    </div>
  );
}

function Stars({ value = 0, size = 18, className = '' }) {
  // Visar 0..5 med decimaler (t.ex. 4.3)
  const full = Math.floor(value);
  const frac = Math.max(0, Math.min(1, value - full));
  return (
    <div className={`flex items-center gap-0.5 ${className}`} aria-label={`${value} av 5`}>
      {[0,1,2,3,4].map((i) => (
        <StarIcon
          key={i}
          size={size}
          fillPct={i < full ? 1 : i === full ? frac : 0}
        />
      ))}
    </div>
  );
}

function StarRatingInput({ value = 0, onChange, size = 22, className = '' }) {
  // Interaktivt 1..5 – tangentbord/hover
  const [hover, setHover] = useState(null);
  const display = hover ?? value;

  return (
    <div
      role="radiogroup"
      aria-label="Betyg"
      className={`flex items-center gap-1 ${className}`}
      onMouseLeave={() => setHover(null)}
    >
      {[1,2,3,4,5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          onClick={() => onChange?.(n)}
          className="focus:outline-none focus:ring-2 focus:ring-rose-300 rounded"
          title={`${n} stjärnor`}
        >
          <StarIcon size={size} fillPct={display >= n ? 1 : 0} />
        </button>
      ))}
    </div>
  );
}


  // popup-render (karta)
  const renderTruckPopupContent = (truck) => {
    const km = isValidLatLng(truck.position) ? haversineKm(userPos, truck.position) : null;
    const mins = km != null ? etaMinutesKm(km, etaMode) : null;

    return (
      <div className="space-y-2">
        <div className="font-extrabold text-lg flex items-center gap-2">
          <span>{truck.name}</span>
          {truck.price && truck.price !== '—' && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">{truck.price}</span>
          )}
          <button
            type="button"
            onClick={() => toggleFavorite(truck.id)}
            className={`ml-auto text-xl ${favIds.includes(truck.id) ? 'text-red-600' : 'text-gray-400'}`}
            aria-label={favIds.includes(truck.id) ? 'Ta bort favorit' : 'Lägg till favorit'}
            title={favIds.includes(truck.id) ? 'Ta bort favorit' : 'Lägg till favorit'}
          >
            {favIds.includes(truck.id) ? '❤️' : '🤍'}
          </button>
        </div>

        <div className="text-sm text-gray-700">🍴 {truck.type || '—'}</div>
        <div className="text-sm text-gray-700" suppressHydrationWarning>{statusLabel(truck)}</div>

        {km != null && (
          <div className="text-sm text-gray-700">
            📍 {km.toFixed(1)} km • {etaMode === 'walk' ? '🚶' : '🚗'} {mins} min
          </div>
        )}
        {truck.menu && <div className="text-sm text-gray-700">📖 {truck.menu}</div>}

        {isValidLatLng(truck.position) && (
          <button
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${truck.position[0]},${truck.position[1]}`, '_blank')}
            className="mt-2 bg-rose-600 text-white px-4 py-2 rounded-xl shadow"
          >
            📍 Navigera hit
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen bg-rose-50 text-gray-900">
      <div className="flex h-screen">
        {/* SIDOMENY (desktop) */}
        <aside className="hidden md:flex w-96 flex-col border-r border-gray-300 bg-rose-50">
          <div className="p-6">
            {/* Sök plats */}
            <div className="flex gap-2">
              <input
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                placeholder="Sök plats (t.ex. Stockholm Central)"
                className="flex-1 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base"
              />
              <button
                onClick={() => geocode(placeQuery)}
                className="rounded-2xl bg-rose-600 text-white px-4 py-3 text-sm"
              >
                Sök
              </button>
            </div>

            {placeResults.length > 0 && (
              <div className="mt-2 rounded-xl bg-white border shadow max-h-56 overflow-auto">
                {placeResults.map((r, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
                      if (Number.isFinite(lat) && Number.isFinite(lon)) {
                        setMapCenter([lat, lon]); setZoom(14); setPlaceResults([]);
                      }
                    }}
                    className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                  >
                    {r.display_name}
                  </button>
                ))}
              </div>
            )}

            {/* Sök + filter */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sök: tacos, ramen, vegan…"
                className="col-span-2 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-blue-200"
              />
              <label className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2">
                <input
                  type="checkbox"
                  checked={openNowOnly}
                  onChange={(e) => setOpenNowOnly(e.target.checked)}
                />
                Öppen nu
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-2xl border border-gray-300 bg-white px-3 py-2"
              >
                <option value="distance">Närmast</option>
                <option value="rating">Bäst betyg (≤10 km)</option>
                <option value="alpha">A–Ö</option>
              </select>

              <div className="col-span-2">
                <div className="inline-flex rounded-xl border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setEtaMode('walk')}
                    className={`px-3 py-2 text-sm ${etaMode==='walk' ? 'bg-rose-600 text-white' : 'bg-white text-gray-700'}`}
                    title="Visa gångtid"
                  >
                    🚶 Gång
                  </button>
                  <button
                    type="button"
                    onClick={() => setEtaMode('drive')}
                    className={`px-3 py-2 text-sm ${etaMode==='drive' ? 'bg-rose-600 text-white' : 'bg-white text-gray-700'}`}
                    title="Visa bil-ETA"
                  >
                    🚗 Bil
                  </button>
                </div>
              </div>
            </div>

            {/* Typ-chippar */}
            <div className="mt-4 flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition shadow-sm ${
                    filterType === t ? 'bg-rose-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Lista (desktop) */}
<div className="flex-1 overflow-auto p-4 space-y-3">
  {filteredTrucks.map((t) => {
    const km = Number.isFinite(t._dist) ? t._dist : null;
    const mins = km != null ? etaMinutesKm(km, etaMode) : null;
    const isSelected = selected && String(selected.id) === String(t.id);

    return (
      <div
        key={t.id}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectTruck(t)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectTruck(t); }}
        data-truck-id={t.id}
        aria-selected={isSelected}
        className={`cursor-pointer select-none w-full text-left p-5 rounded-2xl border transition shadow-sm
          ${isSelected ? 'bg-rose-50 ring-2 ring-rose-400 border-rose-200' : 'bg-white hover:shadow'}
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {t.logo_url ? (
              <img
                src={t.logo_url}
                alt={`${t.name} logo`}
                className="h-9 w-9 rounded-lg object-cover border"
                loading="lazy"
              />
            ) : (
              <img
                src="/foodtruck-marker.png"
                alt="Foodtruck Finder"
                className="h-9 w-9 rounded-lg object-cover border"
                loading="lazy"
              />
            )}

            {/* ingen knapp här – låt hela kortet vara klickbart */}
            <div className="text-left">
              <div className="font-bold text-lg">{t.name}</div>
              <div className="text-sm text-gray-600 mt-0.5">
                {t.type} • <span suppressHydrationWarning>{statusLabel(t)}</span> •{' '}
                {km != null
                  ? <>📍 {km.toFixed(1)} km • {etaMode === 'walk' ? '🚶' : '🚗'} {mins} min</>
                  : '📍 checka in för plats'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleFavorite(t.id); }}
              className={`text-xl ${favIds.includes(t.id) ? 'text-red-600' : 'text-gray-400'}`}
              aria-label={favIds.includes(t.id) ? 'Ta bort favorit' : 'Lägg till favorit'}
              title={favIds.includes(t.id) ? 'Ta bort favorit' : 'Lägg till favorit'}
            >
              {favIds.includes(t.id) ? '❤️' : '🤍'}
            </button>

            {/* gul stjärna + betyg */}
            <div
              className="text-sm flex items-center gap-1"
              aria-label={`Betyg ${Number.isFinite(Number(t.rating)) ? Number(t.rating).toFixed(1) : '–'} av 5`}
            >
              <span className="text-yellow-500" aria-hidden>★</span>
              <span className="tabular-nums">
                {Number.isFinite(Number(t.rating)) && Number(t.rating) > 0 ? Number(t.rating).toFixed(1) : '–'}
              </span>
              {Number.isFinite(t.reviewCount) && t.reviewCount > 0 && (
                <span className="text-xs text-gray-600">({t.reviewCount})</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  })}
</div>

        </aside>

        {/* KARTA + MOBIL */}
        <main className="flex-1 relative">
          {/* Meny-knapp (mobil) */}
          <div className="md:hidden fixed left-3 top-3 z-[10000]">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 shadow border bg-white text-gray-900 text-sm hover:bg-gray-50 active:scale-[.98]"
              aria-label="Öppna meny"
            >
              ☰ Meny
            </button>
          </div>

          {/* Drawer (mobil) */}
          {mobileOpen && (
            <>
              <div
                className="md:hidden fixed inset-0 z-[1090] bg-black/40"
                onClick={() => setMobileOpen(false)}
              />
              <div className="md:hidden fixed left-0 top-0 z-[1100] h-full w-80 max-w-[85%] bg-rose-50 shadow-2xl border-r overflow-auto">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="font-semibold">Meny</div>
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="rounded-lg border px-2 py-1 text-sm"
                  >
                    Stäng
                  </button>
                </div>

                <div className="p-4 border-b">
                  {/* Sök plats */}
                  <div className="flex gap-2">
                    <input
                      value={placeQuery}
                      onChange={(e) => setPlaceQuery(e.target.value)}
                      placeholder="Sök plats (t.ex. Stockholm Central)"
                      className="flex-1 rounded-2xl border border-gray-300 px-4 py-3 text-base bg-white"
                    />
                    <button
                      onClick={() => { geocode(placeQuery); }}
                      className="rounded-2xl bg-rose-600 text-white px-4 py-3 text-sm"
                    >
                      Sök
                    </button>
                  </div>

                  {/* Förslag */}
                  {placeResults.length > 0 && (
                    <div className="mt-2 rounded-xl bg-white border shadow max-h-56 overflow-auto">
                      {placeResults.map((r, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
                            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                              setMapCenter([lat, lon]); setZoom(14); setPlaceResults([]); setMobileOpen(false);
                            }
                          }}
                          className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                        >
                          {r.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lista (mobil) */}
                <div className="p-4 space-y-3">
                  {filteredTrucks.map((t) => {
                    const km = Number.isFinite(t._dist) ? t._dist : null;
                    const mins = km != null ? etaMinutesKm(km, etaMode) : null;
                    const isSelected = selected && String(selected.id) === String(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => { handleSelectTruck(t); setMobileOpen(false); }}
                        aria-selected={isSelected}
                        className={`w-full text-left p-5 rounded-2xl border transition
                          ${isSelected ? 'bg-rose-50 ring-2 ring-rose-400 border-rose-200' : 'bg-white shadow-sm hover:shadow'}
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {t.logo_url ? (
                              <img src={t.logo_url} alt={`${t.name} logo`} className="h-9 w-9 rounded-lg object-cover border" loading="lazy" />
                            ) : (
                              <img src="/foodtruck-marker.png" alt="Foodtruck Finder" className="h-9 w-9 rounded-lg object-cover border" loading="lazy" />
                            )}
                            <div>
                              <div className="font-bold text-lg">{t.name}</div>
                              <div className="text-sm text-gray-600 mt-0.5">
                                {t.type} • <span suppressHydrationWarning>{statusLabel(t)}</span> •{' '}
                                {km != null
                                  ? <>📍 {km.toFixed(1)} km • {etaMode === 'walk' ? '🚶' : '🚗'} {mins} min</>
                                  : '📍 checka in för plats'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xl ${favIds.includes(t.id) ? 'text-red-600' : 'text-gray-400'}`}>
                              {favIds.includes(t.id) ? '❤️' : '🤍'}
                            </span>
<div className="text-sm flex items-center gap-1" aria-label={`Betyg ${Number.isFinite(Number(t.rating)) ? Number(t.rating).toFixed(1) : '–'} av 5`}>
  <span className="text-yellow-500" aria-hidden>★</span>
  <span className="tabular-nums">{Number.isFinite(Number(t.rating)) && Number(t.rating) > 0 ? Number(t.rating).toFixed(1) : '–'}</span>
  {Number.isFinite(t.reviewCount) && t.reviewCount > 0 && (
    <span className="text-xs text-gray-600">({t.reviewCount})</span>
  )}
</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {filteredTrucks.length === 0 && (
                    <div className="p-6 text-sm text-gray-500">Inga träffar.</div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* KARTA */}
          <div className="absolute inset-0 z-0">
            <RealMap
              center={mapCenter}
              zoom={zoom}
              className="z-0"
              trucks={filteredTrucks.filter(t => isValidLatLng(t.position))}
              onTruckClick={handleSelectTruck}
              renderTruckPopupContent={renderTruckPopupContent}
              livePulsePositions={filteredTrucks.filter(t => t.isLive && isValidLatLng(t.position)).map(t => t.position)}
              liveCheckins={liveCheckins.filter(c => !c.ended_at && isValidLatLng([c.lat, c.lng]))}
              onCheckIn={checkInHere}
              onCheckOut={checkOut}
              liveCheckinActive={!!liveCheckin}
              isAdmin={isAdmin}
              isLoggedIn={!!ownerSession}
              onLogout={handleLogout}
              onGoMyTruck={() => { window.location.href = '/mytruck'; }}
              onGoAdmin={() => { window.location.href = '/admin'; }}
              onOpenTruck={() => setPickerOpen(true)}
              hasDefaultTruck={!!selectedTruckId}
            />
          </div>

          {/* Plocka exakt plats när man öppnar truck */}
          <LocationPickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onConfirm={(p) => {
              setPickerOpen(false);
              if (p?.lat && p?.lng) {
                checkInHere({ lat: p.lat, lng: p.lng });
              }
            }}
            storageKey={selectedTruckId ? `ftf_last_open_${selectedTruckId}` : 'ftf_last_open_generic'}
          />

          {/* Bottom sheet för vald truck + RECENSIONER */}
          {selected && isValidLatLng(selected.position) && (
            <div className="absolute left-0 right-0 bottom-0 z-[500]">
              <div className="mx-auto max-w-xl rounded-t-3xl bg-white shadow-2xl border p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-extrabold">{selected.name}</div>
                    <div className="text-sm text-gray-600">
                      {selected.type} • <span suppressHydrationWarning>{statusLabel(selected)}</span> •{' '}
                      <Stars value={selected.rating || 0} size={16} />
                      {Number.isFinite(selected.reviewCount) && selected.reviewCount > 0 ? (
                        <span className="text-xs text-gray-600"> ({selected.reviewCount})</span>
                      ) : null}
                    </div>
                    {isValidLatLng(selected.position) && (() => {
                      const km = haversineKm(userPos, selected.position);
                      const mins = etaMinutesKm(km, etaMode);
                      return (
                        <div className="mt-1 text-sm text-gray-600">
                          📍 {km.toFixed(1)} km • {etaMode === 'walk' ? '🚶' : '🚗'} {mins} min
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelected(null)}
                      className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      Stäng
                    </button>
                  </div>
                </div>

                {/* Recensioner (endast DB-truckar) */}
                {selected.dbId ? (
                  <div className="mt-4 space-y-4">
                    <div className="border-t pt-4">
                      <div className="font-semibold mb-2">Lämna en recension</div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
<StarRatingInput value={revRating} onChange={setRevRating} size={22} />
                        </div>
                        <span className="text-sm text-gray-600">{revRating}/5</span>
                      </div>
                      <textarea
                        value={revComment}
                        onChange={(e) => setRevComment(e.target.value)}
                        placeholder="Skriv några rader…"
                        className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                        rows={3}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={submitReview}
                          disabled={submittingReview || !revComment.trim()}
                          className="rounded-xl bg-rose-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                        >
                          {submittingReview ? 'Skickar…' : 'Skicka recension'}
                        </button>
                        {!ownerSession && (
                          <span className="text-xs text-gray-500">Tips: logga in för att recensera med e-post.</span>
                        )}
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <div className="font-semibold mb-2">Recensioner</div>
                      {reviews.length === 0 && (
                        <div className="text-sm text-gray-500">Inga recensioner ännu.</div>
                      )}
                      <div className="space-y-3 max-h-64 overflow-auto pr-1">
                        {reviews.map((r) => (
                          <div key={r.id} className="rounded-xl border p-3 bg-white">
                            <div className="flex items-center justify-between">
                              <Stars value={r.rating || 0} size={14} />
                              <div className="text-xs text-gray-500" suppressHydrationWarning>
                                {new Date(r.created_at).toLocaleDateString()}
                              </div>
                            </div>
                            {r.user_email && (
                              <div className="text-xs text-gray-600 mt-0.5">{r.user_email}</div>
                            )}
                            <div className="text-sm mt-1 whitespace-pre-wrap">{r.comment}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-gray-500">Recensioner kan lämnas för riktiga foodtrucks.</div>
                )}

                {/* Snabbknappar */}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${selected.position[0]},${selected.position[1]}`, '_blank')}
                    className="bg-rose-600 text-white px-4 py-2 rounded-xl shadow"
                  >
                    Navigera
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="px-4 py-2 rounded-xl shadow bg-gray-100"
                  >
                    Stäng
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
