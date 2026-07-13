'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Bell, Search, Smartphone, Loader2, RefreshCw, Clock, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface NotificationLog {
  id: string;
  app_package: string;
  notification_title: string;
  notification_body: string;
  received_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

const APP_META: Record<string, { label: string; color: string; bg: string }> = {
  whatsapp:  { label: 'WhatsApp',  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20'   },
  instagram: { label: 'Instagram', color: 'text-pink-400',   bg: 'bg-pink-500/10 border-pink-500/20'    },
  telegram:  { label: 'Telegram',  color: 'text-sky-400',    bg: 'bg-sky-500/10 border-sky-500/20'      },
  orca:      { label: 'Messenger', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20'    },
  facebook:  { label: 'Facebook',  color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20'    },
  tiktok:    { label: 'TikTok',    color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20'      },
  musically: { label: 'TikTok',    color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20'      },
  snapchat:  { label: 'Snapchat',  color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  twitter:   { label: 'Twitter/X', color: 'text-zinc-300',   bg: 'bg-zinc-500/10 border-zinc-500/20'    },
  linkedin:  { label: 'LinkedIn',  color: 'text-blue-300',   bg: 'bg-blue-400/10 border-blue-400/20'    },
};

function getAppMeta(pkg: string) {
  for (const [k, v] of Object.entries(APP_META)) if (pkg.toLowerCase().includes(k)) return v;
  return { label: pkg.split('.').pop()?.toUpperCase() || 'APP', color: 'text-accentViolet', bg: 'bg-accentViolet/10 border-accentViolet/20' };
}

export default function NotificationsPage() {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice]         = useState<any>(null);
  const [logs, setLogs]             = useState<NotificationLog[]>([]);
  const [search, setSearch]         = useState('');
  const [filterApp, setFilterApp]   = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const deviceRef = useRef<any>(null);

  const handleDelete = async (id: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    setLogs(prev => prev.filter(l => l.id !== id));
    await supabase.from('notification_logs').delete().eq('id', id);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || deviceRef.current;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('notification_logs')
        .select('*')
        .eq('device_id', target.id)
        .order('received_at', { ascending: false })
        .limit(200);
      if (error) {
        console.error('notification_logs query error:', error);
        setSupabaseError(`Query error: ${error.message}`);
      } else if (data) {
        setLogs(data);
        setLastUpdated(new Date());
        setSupabaseError(null);
      }
    } catch (err: any) {
      console.error(err);
      setSupabaseError(`Network error: ${err?.message ?? err}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setSupabaseError(null);
      try {
        const { data, error } = await supabase
          .from('devices')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) {
          setSupabaseError(`Tidak bisa terhubung ke Supabase: ${error.message}`);
          return;
        }
        if (!data || data.length === 0) return;
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find(d => d.id === savedId) || data[0];
        setDevice(dev);
        deviceRef.current = dev;
        await fetchData(dev);
      } catch (err: any) {
        setSupabaseError(`Network error: ${err?.message ?? err}`);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchData]);

  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel(`notifs-${device.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'notification_logs',
        filter: `device_id=eq.${device.id}`,
      }, (p) => {
        setLogs(prev => [p.new as NotificationLog, ...prev]);
        setLastUpdated(new Date());
      })
      .subscribe();
    const poll = setInterval(() => fetchData(device, true), 15000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [device, fetchData]);

  const appPackages = Array.from(new Set(logs.map(l => l.app_package)));

  const filteredLogs = logs.filter(log => {
    const q = search.toLowerCase();
    const matchSearch =
      (log.notification_title || '').toLowerCase().includes(q) ||
      (log.notification_body  || '').toLowerCase().includes(q) ||
      getAppMeta(log.app_package).label.toLowerCase().includes(q);
    const matchFilter = filterApp === 'all' || log.app_package === filterApp;
    return matchSearch && matchFilter;
  });

  const groupedLogs = filteredLogs.reduce<Record<string, NotificationLog[]>>((acc, log) => {
    const key = new Date(log.received_at).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const todayCount = logs.filter(l =>
    new Date(l.received_at).toDateString() === new Date().toDateString()
  ).length;

  const ErrorBanner = () => supabaseError ? (
    <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-sm">
      <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-red-400">Supabase Error</p>
        <p className="text-red-300/80 text-xs mt-0.5 font-mono break-all">{supabaseError}</p>
        <p className="text-textSecondary text-xs mt-1">Cek: URL Supabase, anon key, dan koneksi internet. Lalu klik Segarkan.</p>
      </div>
    </div>
  ) : null;

  if (loading) return (
    <div className="space-y-4">
      <ErrorBanner />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Menghubungkan ke Supabase...</p>
      </div>
    </div>
  );

  if (!device) return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notifikasi Sosmed (Anti-Hapus)</h1>
        <p className="text-textSecondary mt-1.5">Hubungkan perangkat anak untuk mulai memantau.</p>
      </div>
      <ErrorBanner />
      {!supabaseError && (
        <div className="bg-cardBg border border-borderDark rounded-2xl p-8 text-center max-w-2xl mx-auto space-y-6">
          <div className="p-4 bg-accentViolet/10 rounded-full w-16 h-16 flex items-center justify-center text-accentViolet mx-auto">
            <Smartphone size={32} />
          </div>
          <h2 className="text-xl font-bold text-textPrimary">Belum Ada Perangkat Terhubung</h2>
          <p className="text-sm text-textSecondary leading-relaxed">
            Notifikasi dari WhatsApp, Instagram, Telegram, dll akan tersimpan otomatis setelah HP anak dipasangkan dan Notification Access diaktifkan.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifikasi Sosmed (Anti-Hapus)</h1>
          <p className="text-textSecondary mt-1.5">
            Semua notifikasi masuk di status bar <strong>{device.device_name}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-textSecondary flex items-center gap-1.5">
              <Clock size={12} />{timeAgo(lastUpdated.toISOString())}
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accentViolet opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accentViolet" />
            </span>
            <span className="text-xs text-textSecondary">Live</span>
          </div>
          <button
            onClick={() => fetchData(device)}
            className="flex items-center gap-2 px-4 py-2 bg-cardBg border border-borderDark rounded-xl hover:bg-darkBg transition-colors text-sm font-semibold"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Segarkan
          </button>
        </div>
      </div>

      <ErrorBanner />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Notifikasi', value: logs.length.toString() },
          { label: 'App Terpantau',    value: appPackages.length.toString() },
          { label: 'Hari Ini',         value: todayCount.toString() },
          { label: 'Terbaru Dari',     value: logs.length > 0 ? getAppMeta(logs[0].app_package).label : '—' },
        ].map(s => (
          <div key={s.label} className="bg-cardBg border border-borderDark rounded-xl p-4">
            <p className="text-[11px] text-textSecondary uppercase tracking-wider font-semibold">{s.label}</p>
            <p className="text-xl font-bold mt-1.5 truncate">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter + Feed */}
      <div className="bg-cardBg border border-borderDark rounded-2xl p-5">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-5">
          <div className="relative w-full md:max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-textSecondary">
              <Search size={15} />
            </span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cari pengirim atau isi pesan..."
              className="w-full bg-darkBg/80 border border-borderDark rounded-xl py-2.5 pl-10 pr-4 text-sm text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterApp('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filterApp === 'all' ? 'bg-accentViolet text-white border-accentViolet' : 'bg-darkBg border-borderDark text-textSecondary hover:text-textPrimary'}`}
            >
              Semua
            </button>
            {appPackages.map(pkg => {
              const meta = getAppMeta(pkg);
              return (
                <button key={pkg} onClick={() => setFilterApp(pkg)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filterApp === pkg ? `${meta.bg} ${meta.color}` : 'bg-darkBg border-borderDark text-textSecondary hover:text-textPrimary'}`}>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {Object.keys(groupedLogs).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-textSecondary">
            <Bell size={36} className="opacity-20" />
            <p className="text-sm font-semibold">Belum ada notifikasi masuk.</p>
            <p className="text-xs opacity-60 text-center max-w-sm">
              Pastikan: (1) APK terbaru sudah terinstall, (2) Notification Access aktif di Settings HP anak,
              (3) HP anak menerima notifikasi dari WA/Telegram/Instagram.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedLogs).map(([dateLabel, dayLogs]) => (
              <div key={dateLabel}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[11px] font-semibold text-textSecondary uppercase tracking-wider">{dateLabel}</span>
                  <span className="flex-1 border-t border-borderDark/50" />
                  <span className="text-[11px] text-textSecondary">{dayLogs.length} notif</span>
                </div>
                <div className="space-y-2">
                  {dayLogs.map(log => {
                    const meta = getAppMeta(log.app_package);
                    return (
                      <div key={log.id} className="group flex items-start gap-4 p-4 bg-darkBg/40 border border-borderDark rounded-xl hover:border-borderDark/80 hover:bg-darkBg/60 transition-all">
                        <div className={`flex-shrink-0 p-2.5 rounded-xl border ${meta.bg}`}>
                          <Bell size={16} className={meta.color} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-textPrimary truncate">{log.notification_title || 'Unknown Sender'}</span>
                            <span className={`px-2 py-0.5 border rounded text-[10px] font-bold ${meta.bg} ${meta.color}`}>{meta.label}</span>
                          </div>
                          <p className="text-sm text-textPrimary/80 mt-1.5 leading-relaxed break-words">{log.notification_body}</p>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          <p className="text-xs text-textSecondary font-mono">
                            {new Date(log.received_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </p>
                          <p className="text-[10px] text-textSecondary/60">{timeAgo(log.received_at)}</p>
                          <button
                            onClick={() => handleDelete(log.id)}
                            disabled={deletingIds.has(log.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-textSecondary hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30"
                            title="Hapus entri ini"
                          >
                            {deletingIds.has(log.id) ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
