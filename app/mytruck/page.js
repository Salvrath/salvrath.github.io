'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const DAY_LABELS = [
  { key: 'sun', label: 'Söndag' },
  { key: 'mon', label: 'Måndag' },
  { key: 'tue', label: 'Tisdag' },
  { key: 'wed', label: 'Onsdag' },
  { key: 'thu', label: 'Torsdag' },
  { key: 'fri', label: 'Fredag' },
  { key: 'sat', label: 'Lördag' },
];

export default function MyTruckPage() {
  const supabaseRef = useRef(null);

  const [session, setSession] = useState(null);

  // trucks
  const [myTrucks, setMyTrucks] = useState([]);
  const [selectedTruckId, setSelectedTruckId] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('Mexican');

  // edit
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('Mexican');

  // schedule editor (per truck)
  const [editSchedule, setEditSchedule] = useState({
    mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: ''
  });

  // live check-in state
  const [liveCheckins, setLiveCheckins] = useState([]);
  const [liveCheckin, setLiveCheckin] = useState(null);

  // Auto-checkout (ägarsida)
  const [autoCheckoutAt, setAutoCheckoutAt] = useState(null);
  const [autoMenuOpen, setAutoMenuOpen] = useState(false);

  // UI
  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');

  // logo upload
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // ----- init supabase + subscriptions -----
  useEffect(() => {
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;

      const { createClient } = await import('@supabase/supabase-js');
      const supa = createClient(url, key);
      supabaseRef.current = supa;

const { data } = await supa.auth.getSession();
setSession(data?.session || null);
supa.auth.onAuthStateChange((_e, s) => setSession(s));

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
} catch (e) {}

// och först därefter:
await Promise.all([fetchMyTrucks(), refetchActive()]);

      const ch1 = supa
        .channel('rt-my-checkins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => {
          refetchActive();
        })
        .subscribe();

      const ch2 = supa
        .channel('rt-my-trucks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trucks' }, () => {
          fetchMyTrucks();
        })
        .subscribe();

      return () => {
        try { supa.removeChannel(ch1); } catch {}
        try { supa.removeChannel(ch2); } catch {}
      };
    })();
  }, []);

  // ----- load/save auto-checkout timestamp -----
  useEffect(() => {
    try {
      const s = typeof window !== 'undefined' && localStorage.getItem('ftf_auto_checkout_at');
      if (s) setAutoCheckoutAt(new Date(s));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (autoCheckoutAt) localStorage.setItem('ftf_auto_checkout_at', autoCheckoutAt.toISOString());
      else localStorage.removeItem('ftf_auto_checkout_at');
    } catch {}
  }, [autoCheckoutAt]);

  // ----- auto-checkout poll var 30s -----
  useEffect(() => {
    const id = setInterval(() => {
      if (!liveCheckin || !autoCheckoutAt) return;
      const now = new Date();
      if (now >= autoCheckoutAt) {
        setAutoCheckoutAt(null);
        checkOut();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [liveCheckin, autoCheckoutAt]);

  async function fetchMyTrucks() {
    if (!supabaseRef.current) return;
    const user = (await supabaseRef.current.auth.getUser())?.data?.user;
    if (!user?.id) { setMyTrucks([]); return; }
    const { data, error } = await supabaseRef.current
      .from('trucks')
      .select('id,name,type,logo_url,schedule_json')
      .eq('owner_id', user.id)
      .order('name', { ascending: true });
    if (!error && Array.isArray(data)) {
      setMyTrucks(data);
      if (!selectedTruckId && data[0]?.id) {
        setSelectedTruckId(String(data[0].id));
        try { localStorage.setItem('ftf_owner_truck_id', String(data[0].id)); } catch {}
      }
      // Om vi redigerar en truck: ladda dess schema i editSchedule
      if (editId) {
        const t = data.find(x => x.id === editId);
        if (t?.schedule_json && typeof t.schedule_json === 'object') {
          setEditSchedule({
            mon: t.schedule_json.mon || '',
            tue: t.schedule_json.tue || '',
            wed: t.schedule_json.wed || '',
            thu: t.schedule_json.thu || '',
            fri: t.schedule_json.fri || '',
            sat: t.schedule_json.sat || '',
            sun: t.schedule_json.sun || '',
          });
        }
      }
    }
  }

  async function refetchActive() {
    if (!supabaseRef.current) return;
    const { data } = await supabaseRef.current
      .from('checkins')
      .select('id,truck_id,lat,lng,started_at,ended_at')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(500);
    setLiveCheckins(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    if (!selectedTruckId) { setLiveCheckin(null); return; }
    const current = liveCheckins.find(c => String(c.truck_id) === String(selectedTruckId) && !c.ended_at);
    setLiveCheckin(current || null);
  }, [liveCheckins, selectedTruckId]);

  const createTruck = async () => {
    if (!supabaseRef.current) return;
    const user = (await supabaseRef.current.auth.getUser())?.data?.user;
    if (!user?.id) { alert('Logga in först.'); return; }

    const name = newName.trim();
    const type = newType.trim();
    if (!name) return alert('Ange ett namn.');
    if (!type) return alert('Ange en typ/kök.');

    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from('trucks')
      .insert({ name, type, owner_id: user.id })
      .select('id,name,type,logo_url,schedule_json')
      .single();
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setMyTrucks(prev => [...prev, data].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    setNewName('');
    setNewType('Mexican');

    setSelectedTruckId(String(data.id));
    try { localStorage.setItem('ftf_owner_truck_id', String(data.id)); } catch {}
  };

  const selectDefault = (id) => {
    setSelectedTruckId(String(id));
    try { localStorage.setItem('ftf_owner_truck_id', String(id)); } catch {}
  };

  const startEdit = (t) => {
    setEditId(t.id);
    setEditName(t.name || '');
    setEditType(t.type || 'Mexican');

    // init schedule editor
    const sj = t.schedule_json || {};
    setEditSchedule({
      mon: sj.mon || '',
      tue: sj.tue || '',
      wed: sj.wed || '',
      thu: sj.thu || '',
      fri: sj.fri || '',
      sat: sj.sat || '',
      sun: sj.sun || '',
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
    setEditType('Mexican');
    setEditSchedule({ mon:'',tue:'',wed:'',thu:'',fri:'',sat:'',sun:'' });
  };

  const saveEdit = async () => {
    if (!supabaseRef.current) return;
    if (!editId) return;
    const name = editName.trim();
    const type = editType.trim();
    if (!name) return alert('Ange ett namn.');
    if (!type) return alert('Ange en typ.');

    // rensa tomma strängar -> null
    const cleanedSchedule = Object.fromEntries(
      Object.entries(editSchedule).map(([k,v]) => [k, v?.trim() ? v.trim() : null])
    );

    // försök spara schedule_json också (om kolumnen inte finns ignorerar vi felet)
    let updated = null;
    let errorFinal = null;
    try {
      const { data, error } = await supabaseRef.current
        .from('trucks')
        .update({ name, type, schedule_json: cleanedSchedule })
        .eq('id', editId)
        .select('id,name,type,logo_url,schedule_json')
        .single();
      if (error) throw error;
      updated = data;
    } catch (err) {
      // Fallback: uppdatera utan schedule_json
      const { data, error } = await supabaseRef.current
        .from('trucks')
        .update({ name, type })
        .eq('id', editId)
        .select('id,name,type,logo_url,schedule_json')
        .single();
      if (error) errorFinal = error;
      else updated = data;
    }

    if (errorFinal) return alert(errorFinal.message);

    setMyTrucks(prev => prev.map(t => t.id === updated.id ? updated : t).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    if (String(selectedTruckId) === String(updated.id)) {
      setSelectedTruckId(String(updated.id));
    }
    cancelEdit();
  };

const checkIn = async () => {
  if (!supabaseRef.current) return;
  const supa = supabaseRef.current;

  const raw = selectedTruckId || (typeof window !== 'undefined' ? localStorage.getItem('ftf_owner_truck_id') : '');
  const truckId = raw ? String(raw).trim() : '';
  if (!truckId) return alert('Ingen giltig truck vald.');

  const { data: owns, error: ownsErr } = await supa.rpc('owns_truck', { tid: truckId });
  if (ownsErr) { console.error('owns_truck RPC error', ownsErr); alert('Kunde inte verifiera ägarskap.'); return; }
  if (!owns) return alert('Du kan bara öppna din egen truck.');

  if (!navigator.geolocation) return alert('Geolocation saknas.');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    // varna om dålig noggrannhet
    if (Number.isFinite(accuracy) && accuracy > 50) {
      const ok = confirm(`Platsnoggrannhet är ${Math.round(accuracy)} m. Fortsätta ändå?`);
      if (!ok) return; // låt användaren försöka igen
    }

    const now = new Date().toISOString();
    const { data, error } = await supa
      .from('checkins')
      .insert({ truck_id: truckId, lat, lng, started_at: now })
      .select('*')
      .single();
    if (error) return alert(error.message);

    setLiveCheckins(prev => [data, ...prev]);
    await supa.from('trucks')
      .update({ last_seen_lat: lat, last_seen_lng: lng, last_seen_at: now })
      .eq('id', truckId);
  }, (err) => {
    alert(err?.message || 'Kunde inte hämta position.');
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
};


  const checkOut = async () => {
    if (!supabaseRef.current) return;
    if (!selectedTruckId) return alert('Välj en truck först.');

    const current = liveCheckins.find(c => String(c.truck_id) === String(selectedTruckId) && !c.ended_at);
    if (!current) return alert('Ingen aktiv incheckning hittades.');

    // rensa ev. auto-ut
    setAutoCheckoutAt(null);

    const endedAt = new Date().toISOString();
    const { error } = await supabaseRef.current
      .from('checkins')
      .update({ ended_at: endedAt })
      .eq('id', current.id);

    if (error) return alert(error.message);

    setLiveCheckins(prev => prev.map(c => c.id === current.id ? { ...c, ended_at: endedAt } : c));
  };

  const canCheckIn = useMemo(() => !!selectedTruckId && !liveCheckin, [selectedTruckId, liveCheckin]);
  const canCheckOut = useMemo(() => !!selectedTruckId && !!liveCheckin, [selectedTruckId, liveCheckin]);

  const sendMagicLink = async () => {
    if (!supabaseRef.current) return;
    const email = loginEmail.trim();
    if (!email) return alert('Skriv din e-postadress.');
    await supabaseRef.current.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/mytruck` : undefined,
      },
    });
    alert('Magic link skickad! Kolla din e-post.');
  };

  // ===== Upload logo =====
const uploadLogo = async () => {
  if (!supabaseRef.current) return alert('Supabase saknas');
  if (!selectedTruckId) return alert('Välj en truck först.');
  if (!file) return alert('Välj en bild först.');

  const { data: userRes, error: userErr } = await supabaseRef.current.auth.getUser();
  if (userErr) { console.error('getUser error', userErr); alert(userErr.message); return; }
  const user = userRes?.user;
  if (!user?.id) { alert('Inte inloggad.'); return; }

  const bucket = 'truck-images';
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
  const path = `${user.id}/${String(selectedTruckId)}/logo-${Date.now()}.${ext}`;
  console.log('UPLOAD PATH =', path);

  // 1) Storage upload
  const { error: upErr } = await supabaseRef.current.storage
    .from(bucket)
    .upload(path, file, { cacheControl: '3600', upsert: true });

  if (upErr) {
    console.error('STORAGE UPLOAD ERROR', upErr);
    alert(`Storage-policy stopp: ${upErr.message}`);
    return;
  }

  // 2) Hämta publik URL
  const { data: pub } = supabaseRef.current.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) { alert('Kunde inte hämta public URL'); return; }

  // 3) Uppdatera trucks.logo_url
  const { error: updErr } = await supabaseRef.current
    .from('trucks')
    .update({ logo_url: publicUrl })
    .eq('id', selectedTruckId);

  if (updErr) {
    console.error('TRUCK UPDATE ERROR', updErr);
    alert(`Trucks-policy stopp: ${updErr.message}`);
    return;
  }

  setMyTrucks(prev =>
    prev.map(t => String(t.id) === String(selectedTruckId) ? { ...t, logo_url: publicUrl } : t)
  );
  alert('Logo uppladdad!');
};


  // Auto-checkout helpers
  function scheduleAutoCheckoutIn(minutes) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minutes);
    setAutoCheckoutAt(d);
  }
  function scheduleAutoCheckoutAt(timeHHMM) {
    const [h, m] = timeHHMM.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    if (d < new Date()) d.setDate(d.getDate() + 1);
    setAutoCheckoutAt(d);
  }
  function clearAutoCheckout() {
    setAutoCheckoutAt(null);
  }

  function renderCountdown() {
    if (!autoCheckoutAt) return null;
    const now = new Date();
    const ms = autoCheckoutAt - now;
    if (ms <= 0) return '0m';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }

  // ----------- UI -----------
  if (!session) {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/foodtruck-marker.png" alt="logo" className="h-8 w-8" />
              <h1 className="text-xl font-extrabold tracking-tight">Min foodtruck</h1>
            </div>
            <a href="/" className="text-blue-700 hover:underline">← Till kartan</a>
          </div>
        </header>

        <div className="mx-auto max-w-md px-4 py-10">
          <h2 className="text-lg font-extrabold">Logga in</h2>
          <p className="text-gray-700 mt-1">Vi skickar en magic link till din e-post.</p>
          <div className="mt-4 grid gap-3">
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="you@email.com"
              type="email"
              className="rounded-2xl border px-4 py-3"
            />
            <button
              onClick={sendMagicLink}
              className="rounded-2xl bg-blue-600 text-white px-4 py-3"
            >
              Skicka magic link
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/foodtruck-marker.png" alt="logo" className="h-8 w-8" />
            <h1 className="text-xl font-extrabold tracking-tight">Min foodtruck</h1>
          </div>
          <a href="/" className="text-blue-700 hover:underline">← Till kartan</a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 grid gap-8 md:grid-cols-2">
        {/* Skapa truck */}
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
          <h2 className="text-lg font-extrabold">Skapa ny foodtruck</h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1">
              <span className="text-sm text-gray-700">Namn</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-2xl border px-4 py-3"
                placeholder="Ex: Taco Truck Stockholm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-gray-700">Typ/Kök</span>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="rounded-2xl border px-4 py-3"
              >
                {['Mexican','American','Vegan','Asian','Indian','Thai','BBQ','Pizza','Bakery','Other'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={createTruck}
                disabled={loading}
                className="rounded-2xl bg-emerald-600 text-white px-4 py-3 disabled:opacity-50"
              >
                {loading ? 'Skapar…' : 'Skapa truck'}
              </button>
            </div>
          </div>
        </section>

        {/* Mina trucks */}
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Mina trucks</h2>
            <button
              onClick={fetchMyTrucks}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              title="Uppdatera"
            >
              Uppdatera
            </button>
          </div>

          <div className="mt-4">
            {myTrucks.length === 0 && (
              <div className="text-gray-600">Inga trucks än. Skapa en till vänster.</div>
            )}

            <div className="grid gap-3">
              {myTrucks.map(t => {
                const isDefault = String(selectedTruckId) === String(t.id);
                const editing = editId === t.id;
                const sj = t.schedule_json || {};
                return (
                  <div key={t.id} className="rounded-xl border p-3">
                    {!editing ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {t.logo_url ? (
                            <img src={t.logo_url} alt="logo" className="h-12 w-12 rounded-lg object-cover border" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-gray-100 border flex items-center justify-center text-xs text-gray-500">Logo</div>
                          )}
                          <div>
                            <div className="font-semibold">{t.name}</div>
                            <div className="text-sm text-gray-600">Typ: {t.type || '—'}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              {DAY_LABELS.map((d) => {
                                const val = sj[d.key];
                                return (
                                  <div key={d.key}>
                                    <span className="inline-block w-20">{d.label}</span>
                                    <span className="ml-1">{val ? val.replace('-', ' - ') : '—'}</span>
                                  </div>
                                );
                              })}
                            </div>
                            {isDefault && (
                              <div className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700">
                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Standardtruck
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isDefault && (
                            <button
                              onClick={() => selectDefault(t.id)}
                              className="rounded-lg bg-white border px-3 py-1.5 text-sm hover:bg-gray-50"
                            >
                              Gör till standard
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(t)}
                            className="rounded-lg bg-white border px-3 py-1.5 text-sm hover:bg-gray-50"
                          >
                            Redigera
                          </button>
                          <a
                            href="/"
                            className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm"
                            onClick={() => selectDefault(t.id)}
                            title="Visa på karta"
                          >
                            Visa på karta
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        <div className="grid gap-1">
                          <span className="text-sm text-gray-700">Nytt namn</span>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="rounded-2xl border px-4 py-3"
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-sm text-gray-700">Ny typ/kök</span>
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="rounded-2xl border px-4 py-3"
                          >
                            {['Mexican','American','Vegan','Asian','Indian','Thai','BBQ','Pizza','Bakery','Other'].map(tt => (
                              <option key={tt} value={tt}>{tt}</option>
                            ))}
                          </select>
                        </div>

                        {/* Veckoschema-editor */}
                        <div className="grid gap-2">
                          <span className="text-sm font-semibold text-gray-800">Öppettider (HH:MM-HH:MM, tomt = stängt)</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {DAY_LABELS.map((d) => (
                              <label key={d.key} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                                <span className="text-sm text-gray-700">{d.label}</span>
                                <input
                                  value={editSchedule[d.key] || ''}
                                  onChange={(e) => setEditSchedule(s => ({ ...s, [d.key]: e.target.value }))}
                                  placeholder="11:00-20:00"
                                  className="w-36 rounded-lg border px-2 py-1 text-sm text-right"
                                />
                              </label>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500">Exempel nattpass: <code className="font-mono">18:00-02:00</code></p>
                        </div>

                        {/* Logo-upload UI för just den här trucken */}
                        <div className="grid gap-2">
                          <span className="text-sm text-gray-700">Logo</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e)=>setFile(e.target.files?.[0]||null)}
                              className="text-sm"
                            />
                            <button
                              onClick={uploadLogo}
                              disabled={uploading || !selectedTruckId || String(selectedTruckId) !== String(editId)}
                              className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
                              title={!selectedTruckId ? 'Välj standardtruck först' : (String(selectedTruckId) !== String(editId) ? 'Sätt denna som standardtruck för att ladda upp logo' : 'Ladda upp')}
                            >
                              {uploading ? 'Laddar…' : 'Ladda upp logo'}
                            </button>
                          </div>
                          <p className="text-xs text-gray-500">Tips: PNG med transparent bakgrund blir snyggast.</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button onClick={saveEdit} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm">
                            Spara
                          </button>
                          <button onClick={cancelEdit} className="rounded-lg bg-white border px-3 py-2 text-sm">
                            Avbryt
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live & Auto-checkout för vald truck */}
          {selectedTruckId && (
            <div className="mt-6 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">Live-status</div>
                <div
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${
                    liveCheckin ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-800'
                  }`}
                >
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${liveCheckin ? 'bg-white' : 'bg-gray-500'}`} />
                  <span>{liveCheckin ? 'Live' : 'Offline'}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!liveCheckin ? (
                  <button onClick={checkIn} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm">
                    ✅ Checka in här
                  </button>
                ) : (
                  <button onClick={checkOut} className="rounded-lg bg-red-600 text-white px-3 py-2 text-sm">
                    ❌ Checka ut
                  </button>
                )}

                {/* Auto-checkout menu */}
                <div className="relative">
                  <button
                    onClick={() => setAutoMenuOpen(v => !v)}
                    className="flex items-center gap-2 bg-white border shadow px-3 py-2 rounded-lg hover:bg-gray-50 text-sm"
                    title="Schemalägg auto-checkout"
                  >
                    ⏱ Auto-ut{autoCheckoutAt ? `: ${autoCheckoutAt.toLocaleTimeString().slice(0,5)}` : ''}
                  </button>
                  {autoMenuOpen && (
                    <div className="absolute z-10 right-0 mt-1 w-56 bg-white border shadow-lg rounded-lg p-2 text-sm">
                      <div className="text-gray-600 px-2 py-1">Snabbval</div>
                      <button onClick={() => { scheduleAutoCheckoutIn(30); setAutoMenuOpen(false); }} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50">+30 min</button>
                      <button onClick={() => { scheduleAutoCheckoutIn(60); setAutoMenuOpen(false); }} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50">+1 timme</button>
                      <button onClick={() => { scheduleAutoCheckoutIn(120); setAutoMenuOpen(false); }} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50">+2 timmar</button>
                      <div className="border-t my-1" />
                      <button
                        onClick={() => {
                          const hhmm = prompt('Sluttid idag (HH:MM):', '21:00');
                          if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) scheduleAutoCheckoutAt(hhmm);
                          setAutoMenuOpen(false);
                        }}
                        className="w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Välj klockslag…
                      </button>
                      <button onClick={() => { clearAutoCheckout(); setAutoMenuOpen(false); }} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-red-600">
                        Rensa auto-ut
                      </button>
                    </div>
                  )}
                </div>

                {/* Countdown badge */}
                {autoCheckoutAt && (
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">
                    Checkas ut om {renderCountdown()}
                  </span>
                )}

                <p className="text-sm text-gray-600">Checka in där du står för att synas på kartan.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
