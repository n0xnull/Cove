'use client';

import React, { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Loader2, RefreshCw, Search, PhoneOff, CheckCircle2, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface CallLog {
  id: number;
  device_id: string;
  phone_number: string;
  contact_name: string;
  direction: 'INCOMING' | 'OUTGOING' | 'MISSED' | 'REJECTED' | 'UNKNOWN';
  duration_seconds: number;
  recorded_at: string;
}

const DIRECTION_CONFIG = {
  INCOMING: { label: '← Masuk',    cls: 'text-accentGreen  bg-accentGreen/10  border-accentGreen/20',  icon: PhoneIncoming  },
  OUTGOING: { label: '→ Keluar',   cls: 'text-accentBlue   bg-accentBlue/10   border-accentBlue/20',   icon: PhoneOutgoing  },
  MISSED:   { label: '✗ Missed',   cls: 'text-accentRed    bg-accentRed/10    border-accentRed/20',    icon: PhoneMissed    },
  REJECTED: { label: '✗ Ditolak',  cls: 'text-accentOrange bg-accentOrange/10 border-accentOrange/20', icon: PhoneOff       },
  UNKNOWN:  { label: '? Unknown',  cls: 'text-textSecondary bg-cardBg border-borderDark',              icon: Phone          },
};

const formatDuration = (s: number): string => {
  if (s === 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}j ${m}m ${sec}d`;
  if (m > 0) return `${m}m ${sec}d`;
  return `${s}d`;
};

export default function CallsPage() {
  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<any>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [search, setSearch] = useState('');
  const [filterDir, setFilterDir] = useState<string>('all');

  const [triggeringSync, setTriggeringSync] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: devicesData } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (devicesData && devicesData.length > 0) {
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const activeDevice = devicesData.find(d => d.id === savedId) || devicesData[0];
        setDevice(activeDevice);

        const { data: callsData } = await supabase
          .from('calls')
          .select('*')
          .eq('device_id', activeDevice.id)
          .order('recorded_at', { ascending: false })
          .limit(200);

        if (callsData) setCalls(callsData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshFromPhone = async () => {
    if (!device || triggeringSync) return;
    setTriggeringSync(true);
    setSyncSuccess(false);
    try {
      const { data, error } = await supabase
        .from('screenshot_commands')
        .insert({
          device_id: device.id,
          command_type: 'CALLS',
          status: 'PENDING'
        })
        .select()
        .single();

      if (error) throw error;
      const cmdId = data.id;

      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const { data: cmd, error: cmdErr } = await supabase
          .from('screenshot_commands')
          .select('status')
          .eq('id', cmdId)
          .single();

        if (!cmdErr && cmd) {
          if (cmd.status === 'EXECUTED') {
            clearInterval(interval);
            setSyncSuccess(true);
            setTriggeringSync(false);
            fetchData();
            setTimeout(() => setSyncSuccess(false), 3000);
          } else if (cmd.status === 'FAILED' || attempts > 20) {
            clearInterval(interval);
            setTriggeringSync(false);
            alert('Gagal menyinkronkan data dari HP anak. Pastikan HP anak aktif dan terhubung internet.');
          }
        }
      }, 2000);

    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal mengirim perintah sinkronisasi');
      setTriggeringSync(false);
    }
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('calls_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat log panggilan...</p>
      </div>
    );
  }

  // Stats
  const total    = calls.length;
  const incoming = calls.filter(c => c.direction === 'INCOMING').length;
  const outgoing = calls.filter(c => c.direction === 'OUTGOING').length;
  const missed   = calls.filter(c => c.direction === 'MISSED' || c.direction === 'REJECTED').length;
  const totalDuration = calls.reduce((sum, c) => sum + c.duration_seconds, 0);

  // Filter + search
  const filtered = calls.filter(c => {
    const matchSearch = (c.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
                        c.phone_number.includes(search);
    const matchDir = filterDir === 'all' || c.direction === filterDir;
    return matchSearch && matchDir;
  });

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('calls').delete().eq('device_id', device.id);
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
          <h1 className="text-3xl font-bold tracking-tight">Log Panggilan</h1>
          <p className="text-textSecondary mt-1">Riwayat telepon masuk, keluar, dan tidak diangkat</p>
        </div>
        <div className="flex items-center gap-3">
          {triggeringSync && (
            <span className="text-xs text-violetLight animate-pulse flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Menyinkronkan dari HP...
            </span>
          )}
          {syncSuccess && (
            <span className="text-xs text-accentGreen flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              Sinkron Berhasil!
            </span>
          )}
          <button 
            onClick={handleRefreshFromPhone} 
            disabled={triggeringSync}
            className="flex items-center gap-2 px-4 py-2 glass-card rounded-xl hover:border-borderDark disabled:opacity-50 transition-colors text-sm font-semibold text-textSecondary hover:text-textPrimary"
          >
            <RefreshCw size={16} className={triggeringSync ? 'animate-spin' : ''} />
            Minta Update HP
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Log'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'Total',         value: total,         cls: 'text-textPrimary',   icon: Phone          },
          { label: 'Masuk',         value: incoming,      cls: 'text-accentGreen',   icon: PhoneIncoming  },
          { label: 'Keluar',        value: outgoing,      cls: 'text-accentBlue',    icon: PhoneOutgoing  },
          { label: 'Missed/Ditolak',value: missed,        cls: 'text-accentRed',     icon: PhoneMissed    },
          { label: 'Total Durasi',  value: formatDuration(totalDuration), cls: 'text-violetLight', icon: Phone },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="glass-card rounded-xl p-4 flex items-center gap-3">
              <Icon size={18} className={stat.cls} />
              <div>
                <p className={`text-lg font-bold ${stat.cls}`}>{stat.value}</p>
                <p className="text-[10px] text-textSecondary">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap">
          {[
            { key: 'all',      label: 'Semua' },
            { key: 'INCOMING', label: '← Masuk' },
            { key: 'OUTGOING', label: '→ Keluar' },
            { key: 'MISSED',   label: '✗ Missed' },
            { key: 'REJECTED', label: '✗ Ditolak' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilterDir(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                filterDir === f.key
                  ? 'bg-accentViolet/15 text-violetLight border-accentViolet/40'
                  : 'glass-card text-textSecondary hover:text-textPrimary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
          <input
            type="text"
            placeholder="Cari kontak atau nomor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-darkBg border border-borderDark rounded-lg pl-9 pr-4 py-2 text-xs text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet"
          />
        </div>
      </div>

      {/* Call log table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Phone size={32} className="text-textSecondary mx-auto mb-3" />
            <p className="text-sm text-textSecondary">
              {calls.length === 0 ? 'Belum ada log panggilan. Data akan muncul setelah agen Android mengirim data.' : 'Tidak ada panggilan yang cocok.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-borderDark text-textSecondary text-xs font-semibold bg-darkBg/40">
                  <th className="pb-3 pt-4 px-5">Waktu</th>
                  <th className="pb-3 pt-4 px-5">Kontak / Nomor</th>
                  <th className="pb-3 pt-4 px-5">Arah</th>
                  <th className="pb-3 pt-4 px-5">Durasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderDark/30">
                {filtered.map((call) => {
                  const cfg = DIRECTION_CONFIG[call.direction] || DIRECTION_CONFIG.UNKNOWN;
                  const Icon = cfg.icon;
                  return (
                    <tr key={call.id} className="hover:bg-cardBg/30 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="text-xs text-textPrimary font-medium">
                          {new Date(call.recorded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                        </div>
                        <div className="text-[10px] text-textSecondary">
                          {new Date(call.recorded_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-textPrimary text-sm">
                          {call.contact_name || 'Unknown'}
                        </div>
                        <div className="text-[11px] text-textSecondary font-mono">{call.phone_number}</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.cls}`}>
                          <Icon size={12} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="font-mono text-sm text-textPrimary">{formatDuration(call.duration_seconds)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
