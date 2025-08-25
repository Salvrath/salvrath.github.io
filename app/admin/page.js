'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function AdminPage() {
  const supabaseRef = useRef(null);
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // --- UI state ---
  const [tab, setTab] = useState('trucks'); // 'trucks' | 'reviews' | 'flags'

  // --- Trucks ---
  const [trucks, setTrucks] = useState([]); // {id,name,type,logo_url,owner_id,last_seen_*}
  const [truckQuery, setTruckQuery] = useState('');
  const [trucksLoading, setTrucksLoading] = useState(false);

  // Delete confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [truckToDelete, setTruckToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // --- Reviews / Flags ---
  const [q, setQ] = useState('');
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [onlyFlaggedOpen, setOnlyFlaggedOpen] = useState(true);
  const [reviews, setReviews] = useState([]); // {id,truck_id,rating,comment,is_hidden,created_at,user_email,truck_name}
  const [flags, setFlags] = useState([]);     // {id,review_id,reason,status,created_at}

  // ---------- Non-admin guard ----------
  const Guard = ({ children }) => (
    <div className="min-h-[60vh] flex items-center justify-center text-center">
      <div className="max-w-md">
        <img src="/foodtruck-marker.png" className="mx-auto mb-4 h-12 w-12" alt="logo" />
        <h1 className="text-2xl font-extrabold">Admin</h1>
        <p className="mt-2 text-gray-600">You must be logged in as an admin to view this page.</p>
        <div className="mt-6">
          {!session ? (
            <EmailLogin onSubmit={async (email) => {
              if (!supabaseRef.current) return;
              await supabaseRef.current.auth.signInWithOtp({
                email,
                options: {
                  emailRedirectTo: typeof window !== 'undefined'
                    ? `${window.location.origin}/admin`
                    : undefined
                }
              });
              alert('Magic link sent! Check your email.');
            }} />
          ) : (
            <p className="text-gray-700">
              Logged in as <span className="font-semibold">{session.user.email}</span> but not an admin.
            </p>
          )}
        </div>
      </div>
    </div>
  );

  // ---------- Init Supabase + auth + realtime ----------
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

      // Admin-koll via RPC is_admin(uid)
      const user = (await supa.auth.getUser())?.data?.user;
      if (user?.id) {
        try {
          const { data: isA } = await supa.rpc('is_admin', { uid: user.id });
          setIsAdmin(!!isA);
        } catch { setIsAdmin(false); }
      }

      await Promise.all([fetchTrucks(), fetchReviews(), fetchFlags()]);

      // realtime uppdateringar
      const chReviews = supa
        .channel('rt:reviews')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => {
          fetchReviews(); fetchFlags();
        })
        .subscribe();

      const chFlags = supa
        .channel('rt:review_flags')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'review_flags' }, () => {
          fetchFlags();
        })
        .subscribe();

      const chTrucks = supa
        .channel('rt:trucks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trucks' }, () => {
          fetchTrucks();
        })
        .subscribe();

      return () => {
        try { supa.removeChannel(chReviews); } catch {}
        try { supa.removeChannel(chFlags); } catch {}
        try { supa.removeChannel(chTrucks); } catch {}
      };
    })();
  }, []);

  // ---------- Fetchers ----------
  async function fetchTrucks() {
    if (!supabaseRef.current) return;
    setTrucksLoading(true);
    try {
      const { data, error } = await supabaseRef.current
        .from('trucks')
        .select('id,name,type,logo_url,owner_id,last_seen_lat,last_seen_lng,last_seen_at,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (!error && Array.isArray(data)) setTrucks(data);
    } finally {
      setTrucksLoading(false);
    }
  }

  async function fetchReviews() {
    if (!supabaseRef.current) return;
    const { data, error } = await supabaseRef.current
      .from('reviews')
      .select('id,truck_id,rating,comment,user_email,is_hidden,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return;

    // hämta truck-namn
    const truckIds = Array.from(new Set((data || []).map(r => r.truck_id))).filter(Boolean);
    let nameMap = {};
    if (truckIds.length) {
      const { data: trucksList } = await supabaseRef.current
        .from('trucks')
        .select('id,name')
        .in('id', truckIds);
      (trucksList || []).forEach(t => { nameMap[t.id] = t.name; });
    }
    setReviews((data || []).map(r => ({ ...r, truck_name: nameMap[r.truck_id] || `#${r.truck_id}` })));
  }

  async function fetchFlags() {
    if (!supabaseRef.current) return;
    const { data } = await supabaseRef.current
      .from('review_flags')
      .select('id,review_id,reason,status,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    setFlags(data || []);
  }

  // ---------- Filters ----------
  const filteredTrucks = useMemo(() => {
    let list = trucks;
    if (truckQuery.trim()) {
      const s = truckQuery.toLowerCase();
      list = list.filter(t =>
        (t.name || '').toLowerCase().includes(s) ||
        (t.type || '').toLowerCase().includes(s) ||
        String(t.id).includes(s)
      );
    }
    return list;
  }, [trucks, truckQuery]);

  const filteredReviews = useMemo(() => {
    let list = reviews;
    if (onlyHidden) list = list.filter(r => r.is_hidden);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(r =>
        (r.comment || '').toLowerCase().includes(s) ||
        (r.user_email || '').toLowerCase().includes(s) ||
        (r.truck_name || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [reviews, q, onlyHidden]);

  const filteredFlags = useMemo(() => {
    let list = flags;
    if (onlyFlaggedOpen) list = list.filter(f => (f.status || 'open') === 'open');
    return list;
  }, [flags, onlyFlaggedOpen]);

  // ---------- Mutations ----------
  const setHidden = async (reviewId, hide) => {
    if (!supabaseRef.current) return;
    await supabaseRef.current.from('reviews').update({ is_hidden: !!hide }).eq('id', reviewId);
  };
  const setFlagStatus = async (flagId, status) => {
    if (!supabaseRef.current) return;
    await supabaseRef.current.from('review_flags').update({ status }).eq('id', flagId);
  };

  const askDeleteTruck = (t) => {
    setTruckToDelete(t);
    setConfirmOpen(true);
  };

  const deleteTruckConfirmed = async () => {
    if (!supabaseRef.current || !truckToDelete) return;
    const id = truckToDelete.id;
    setDeleting(true);
    try {
      // Radera relaterade reviews och checkins först (kräver admin-behörighet/RLS)
      await supabaseRef.current.from('review_flags')
        .delete()
        .in('review_id', (await supabaseRef.current.from('reviews').select('id').eq('truck_id', id)).data?.map(r => r.id) || []);
      await supabaseRef.current.from('reviews').delete().eq('truck_id', id);
      await supabaseRef.current.from('checkins').delete().eq('truck_id', id);

      // Radera truck
      const { error } = await supabaseRef.current.from('trucks').delete().eq('id', id);
      if (error) throw error;

      // Uppdatera lokalt
      setTrucks(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      console.error(e);
      alert(e.message || 'Kunde inte radera trucken. Kontrollera RLS/policies.');
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
      setTruckToDelete(null);
    }
  };

  if (!isAdmin) return <Guard />;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/foodtruck-marker.png" alt="logo" className="h-8 w-8" />
            <h1 className="text-xl font-extrabold tracking-tight">Admin dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-sm font-medium text-blue-700 hover:underline">Till kartan</a>
          </div>
        </div>
        {/* Tabs (matchar vår “chip”-stil) */}
        <div className="mx-auto max-w-7xl px-4 pb-3">
          <div className="flex gap-2">
            {[
              { id: 'trucks', label: 'Foodtrucks' },
              { id: 'reviews', label: 'Reviews' },
              { id: 'flags', label: 'Flags' },
            ].map(ti => (
              <button
                key={ti.id}
                onClick={() => setTab(ti.id)}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition shadow-sm ${
                  tab === ti.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                }`}
              >
                {ti.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 grid gap-8 md:grid-cols-2">
        {/* ---------- TRUCKS PANEL ---------- */}
        {tab === 'trucks' && (
          <section className="md:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-extrabold">Foodtrucks</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchTrucks}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                  title="Uppdatera"
                >
                  Uppdatera
                </button>
              </div>
            </div>

            <div className="mt-3 flex gap-2 items-center">
              <input
                value={truckQuery}
                onChange={e => setTruckQuery(e.target.value)}
                placeholder="Sök: namn, typ, #id…"
                className="flex-1 rounded-2xl border px-4 py-3"
              />
              {trucksLoading && <span className="text-sm text-gray-600">Laddar…</span>}
            </div>

            <div className="mt-4 divide-y max-h-[65vh] overflow-auto">
              {filteredTrucks.map(t => (
                <div key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {t.logo_url ? (
                      <img src={t.logo_url} alt="logo" className="h-12 w-12 rounded-lg object-cover border" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-gray-100 border flex items-center justify-center text-xs text-gray-500">Logo</div>
                    )}
                    <div>
                      <div className="font-semibold">{t.name} <span className="text-xs text-gray-500">#{t.id}</span></div>
                      <div className="text-sm text-gray-600">Typ: {t.type || '—'}</div>
                      <div className="text-xs text-gray-600 mt-1">
                        Skapad: {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Senast sedd: {t.last_seen_at ? new Date(t.last_seen_at).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="/"
                      className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm"
                      title="Visa på karta"
                    >
                      Visa på karta
                    </a>
                    <button
                      onClick={() => askDeleteTruck(t)}
                      className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-sm"
                      title="Radera truck"
                    >
                      Radera
                    </button>
                  </div>
                </div>
              ))}
              {filteredTrucks.length === 0 && (
                <div className="py-10 text-center text-gray-500">Inga foodtrucks hittades.</div>
              )}
            </div>
          </section>
        )}

        {/* ---------- REVIEWS PANEL ---------- */}
        {tab === 'reviews' && (
          <section className="md:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-extrabold">Reviews</h2>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyHidden} onChange={e => setOnlyHidden(e.target.checked)} />
                  Only hidden
                </label>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by text, email, truck…"
                className="flex-1 rounded-2xl border px-4 py-3"
              />
            </div>

            <div className="mt-4 divide-y max-h-[65vh] overflow-auto">
              {filteredReviews.map(r => (
                <div key={r.id} className="py-3 flex items-start gap-3">
                  <div className="mt-1 text-sm min-w-10 text-center">
                    <div className="font-semibold">{r.rating}★</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{r.truck_name}</span>
                      <span>•</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      {r.user_email && (<><span>•</span><span>{r.user_email}</span></>)}
                      {r.is_hidden && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-900 text-white">HIDDEN</span>}
                    </div>
                    <div className="mt-1 text-base">{r.comment}</div>
                    <div className="mt-2 flex items-center gap-2">
                      {!r.is_hidden ? (
                        <button onClick={() => setHidden(r.id, true)} className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-sm">Hide</button>
                      ) : (
                        <button onClick={() => setHidden(r.id, false)} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm">Unhide</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filteredReviews.length === 0 && (
                <div className="py-10 text-center text-gray-500">No reviews found.</div>
              )}
            </div>
          </section>
        )}

        {/* ---------- FLAGS PANEL ---------- */}
        {tab === 'flags' && (
          <section className="md:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-extrabold">Flags</h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyFlaggedOpen} onChange={e => setOnlyFlaggedOpen(e.target.checked)} />
                  Only open
                </label>
              </div>
            </div>

            <div className="mt-4 divide-y max-h-[65vh] overflow-auto">
              {filteredFlags.map(f => (
                <div key={f.id} className="py-3">
                  <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">Flag #{f.id}</span>
                    <span>•</span>
                    <span>{new Date(f.created_at).toLocaleString()}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${f.status === 'open' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                      {f.status || 'open'}
                    </span>
                  </div>
                  <div className="mt-1 text-base">Reason: {f.reason || '—'}</div>
                  <div className="mt-2 flex items-center gap-2">
                    {f.status !== 'resolved' && (
                      <button onClick={() => setFlagStatus(f.id, 'resolved')} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm">
                        Mark resolved
                      </button>
                    )}
                    {f.status !== 'open' && (
                      <button onClick={() => setFlagStatus(f.id, 'open')} className="rounded-lg bg-gray-900 text-white px-3 py-1.5 text-sm">
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {filteredFlags.length === 0 && (
                <div className="py-10 text-center text-gray-500">No flags found.</div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ---- Confirm Delete Modal ---- */}
      {confirmOpen && truckToDelete && (
        <div className="fixed inset-0 z-[800]">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setConfirmOpen(false)} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95%] max-w-md rounded-2xl bg-white shadow-2xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-extrabold text-lg">Radera foodtruck</div>
              <button
                onClick={() => !deleting && setConfirmOpen(false)}
                className="rounded-full border px-2 py-1 text-sm disabled:opacity-50"
                disabled={deleting}
              >
                Stäng
              </button>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                Är du säker på att du vill radera <span className="font-semibold">{truckToDelete.name}</span> <span className="text-gray-500">#{truckToDelete.id}</span>?
              </p>
              <p className="text-red-700">
                Detta tar även bort relaterade <strong>checkins</strong> och <strong>reviews</strong>.
              </p>
            </div>
            <div className="pt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
                disabled={deleting}
              >
                Avbryt
              </button>
              <button
                onClick={deleteTruckConfirmed}
                className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                disabled={deleting}
              >
                {deleting ? 'Raderar…' : 'Radera'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function EmailLogin({ onSubmit }) {
  const [email, setEmail] = useState('');
  return (
    <div className="grid gap-2">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="rounded-2xl border px-4 py-3"
        type="email"
      />
      <button
        onClick={() => onSubmit(email)}
        className="rounded-2xl bg-blue-600 text-white px-4 py-3"
      >
        Send magic link
      </button>
    </div>
  );
}
