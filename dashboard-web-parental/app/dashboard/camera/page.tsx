'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Aperture, RefreshCw, Loader2, AlertTriangle, ZoomIn, X, Trash2, Download } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface CameraCommand {
  id: number;
  device_id: string;
  camera_side: 'FRONT' | 'BACK';
  status: 'PENDING' | 'EXECUTED' | 'FAILED';
  storage_path: string | null;
  file_size_bytes: number | null;
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
}

type DateFilter = '1d' | '7d' | '30d';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const SIDE_CONFIG = {
  FRONT: { label: 'Depan', color: 'text-accentBlue',   bg: 'bg-accentBlue/10',   border: 'border-accentBlue/30'   },
  BACK:  { label: 'Belakang', color: 'text-accentGreen', bg: 'bg-accentGreen/10', border: 'border-accentGreen/30' },
};

const STATUS_CONFIG = {
  PENDING:  { label: 'Menunggu…', color: 'text-accentYellow', dot: 'bg-accentYellow animate-pulse' },
  EXECUTED: { label: 'Selesai',   color: 'text-accentGreen',  dot: 'bg-accentGreen'               },
  FAILED:   { label: 'Gagal',     color: 'text-accentRed',    dot: 'bg-accentRed'                 },
};

export default function CameraPage() {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice]         = useState<any>(null);
  const [commands, setCommands]     = useState<CameraCommand[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>({});
  const [loadingUrls, setLoadingUrls] = useState<Set<number>>(new Set());
  const [error, setError]           = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('7d');
  const [triggeringFront, setTriggeringFront] = useState(false);
  const [triggeringBack, setTriggeringBack]   = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [lightboxUrl, setLightboxUrl]   = useState<string | null>(null);
  const [lightboxCmd, setLightboxCmd]   = useState<CameraCommand | null>(null);

  const getSince = (f: DateFilter) => {
    const d = f === '1d' ? 1 : f === '7d' ? 7 : 30;
    return new Date(Date.now() - d * 86400000).toISOString();
  };

  const fetchSignedUrls = useCallback(async (items: CameraCommand[]) => {
    const toFetch = items.filter(c => c.storage_path && !signedUrls[c.id]);
    if (!toFetch.length) return;
    setLoadingUrls(prev => { const n = new Set(prev); toFetch.forEach(c => n.add(c.id)); return n; });
    const results: Record<number, string> = {};
    await Promise.all(toFetch.map(async (c) => {
      if (!c.storage_path) return;
      try {
        const { data } = await supabase.storage.from('camera-photos').createSignedUrl(c.storage_path, 3600);
        if (data?.signedUrl) results[c.id] = data.signedUrl;
        else {
          const { data: pub } = supabase.storage.from('camera-photos').getPublicUrl(c.storage_path);
          if (pub?.publicUrl) results[c.id] = pub.publicUrl;
        }
      } catch (_) {}
    }));
    setSignedUrls(prev => ({ ...prev, ...results }));
    setLoadingUrls(prev => { const n = new Set(prev); toFetch.forEach(c => n.delete(c.id)); return n; });
  }, [signedUrls]);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error: e } = await supabase
        .from('camera_commands')
        .select('*')
        .eq('device_id', target.id)
        .gte('created_at', getSince(dateFilter))
        .order('created_at', { ascending: false })
        .limit(100);
      if (e) throw e;
      const items = data || [];
      setCommands(items);
      setError(null);
      await fetchSignedUrls(items.filter(c => c.status === 'EXECUTED').slice(0, 12));
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data kamera');
    } finally {
      setRefreshing(false);
    }
  }, [device, dateFilter, fetchSignedUrls]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) { setLoading(false); return; }
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  useEffect(() => { fetchData(); }, [dateFilter]);

  // Realtime: auto-refresh saat ada command baru / status update
  useEffect(() => {
    if (!device) return;
    const ch = supabase.channel(`cam-${device.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'camera_commands', filter: `device_id=eq.${device.id}` },
        () => fetchData(device, true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [device, fetchData]);

  const triggerCapture = async (side: 'FRONT' | 'BACK') => {
    if (!device) return;
    if (side === 'FRONT') setTriggeringFront(true);
    else setTriggeringBack(true);
    try {
      const { error } = await supabase.from('camera_commands').insert({ device_id: device.id, camera_side: side, status: 'PENDING' });
      if (error) throw error;
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengirim perintah kamera');
    } finally {
      if (side === 'FRONT') setTriggeringFront(false);
      else setTriggeringBack(false);
    }
  };

  const handleDelete = async (cmd: CameraCommand) => {
    setDeletingIds(prev => new Set(prev).add(cmd.id));
    if (lightboxCmd?.id === cmd.id) { setLightboxUrl(null); setLightboxCmd(null); }
    setCommands(prev => prev.filter(c => c.id !== cmd.id));
    await supabase.from('camera_commands').delete().eq('id', cmd.id);
    if (cmd.storage_path) await supabase.storage.from('camera-photos').remove([cmd.storage_path]);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(cmd.id); return n; });
  };

  const openLightbox = async (cmd: CameraCommand) => {
    let url = signedUrls[cmd.id];
    if (!url && cmd.storage_path) {
      const { data } = await supabase.storage.from('camera-photos').createSignedUrl(cmd.storage_path, 3600);
      url = data?.signedUrl || '';
      if (url) setSignedUrls(prev => ({ ...prev, [cmd.id]: url }));
    }
    setLightboxUrl(url);
    setLightboxCmd(cmd);
  };

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      // Delete storage files
      const { data: rows } = await supabase.from('camera_commands').select('storage_path').eq('device_id', device.id);
      if (rows && rows.length > 0) {
        const paths = rows.map((r: any) => r.storage_path).filter(Boolean);
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage.from('camera-photos').remove(paths.slice(i, i + 100));
        }
      }
      // Delete DB rows
      await supabase.from('camera_commands').delete().eq('device_id', device.id);
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
      <p className="text-sm">Memuat galeri kamera...</p>
    </div>
  );

  const photos  = commands.filter(c => c.status === 'EXECUTED' && c.storage_path);
  const pending = commands.filter(c => c.status === 'PENDING');
  const failed  = commands.filter(c => c.status === 'FAILED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kamera Perangkat</h1>
          <p className="text-textSecondary mt-1 text-sm">Ambil foto dari kamera depan atau belakang perangkat anak</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['1d','7d','30d'] as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${dateFilter === f ? 'bg-accentViolet text-white' : 'glass-card text-textSecondary hover:text-textPrimary'}`}>
              {f === '1d' ? 'Hari Ini' : f === '7d' ? '7 Hari' : '30 Hari'}
            </button>
          ))}
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Foto'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs font-mono">{error}</p>
        </div>
      )}

      {/* Trigger buttons */}
      <div className="grid grid-cols-2 gap-4">
        {(['BACK', 'FRONT'] as const).map(side => {
          const cfg = SIDE_CONFIG[side];
          const isTriggering = side === 'FRONT' ? triggeringFront : triggeringBack;
          return (
            <button key={side} onClick={() => triggerCapture(side)} disabled={isTriggering || !device}
              className={`glass-card rounded-2xl p-6 flex flex-col items-center gap-3 border ${cfg.border} hover:${cfg.bg} transition-all disabled:opacity-50 group`}>
              <div className={`p-4 rounded-full ${cfg.bg} group-hover:scale-110 transition-transform`}>
                {isTriggering
                  ? <Loader2 size={28} className={`animate-spin ${cfg.color}`} />
                  : <Aperture size={28} className={cfg.color} />}
              </div>
              <div className="text-center">
                <p className={`font-bold text-sm ${cfg.color}`}>Kamera {cfg.label}</p>
                <p className="text-[11px] text-textSecondary mt-0.5">{isTriggering ? 'Mengirim perintah…' : 'Klik untuk ambil foto'}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Foto Berhasil', value: photos.length,  color: 'text-accentGreen'  },
          { label: 'Menunggu',      value: pending.length, color: 'text-accentYellow' },
          { label: 'Gagal',         value: failed.length,  color: 'text-accentRed'    },
        ].map((s, i) => (
          <div key={i} className="glass-card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-textSecondary mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pending notice */}
      {pending.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-accentYellow/5 border border-accentYellow/20 rounded-xl">
          <Loader2 size={16} className="animate-spin text-accentYellow shrink-0" />
          <p className="text-xs text-accentYellow">{pending.length} perintah menunggu dieksekusi oleh perangkat (maks ~15 detik).</p>
        </div>
      )}

      {/* Photo grid */}
      {commands.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <Aperture size={48} className="text-textSecondary/30 mx-auto mb-4" />
          <p className="text-sm text-textSecondary">Belum ada foto untuk periode ini. Klik tombol di atas untuk mengambil foto.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Failed list */}
          {failed.length > 0 && (
            <div className="glass-card rounded-xl overflow-hidden border border-accentRed/20">
              <div className="px-4 py-2.5 border-b border-accentRed/20 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accentRed" />
                <span className="text-xs font-bold text-accentRed">{failed.length} Perintah Gagal</span>
              </div>
              {failed.map(cmd => (
                <div key={cmd.id} className="flex items-center gap-3 px-4 py-2.5 text-xs border-b border-borderDark/20 last:border-0">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${SIDE_CONFIG[cmd.camera_side].bg} ${SIDE_CONFIG[cmd.camera_side].color}`}>
                    {SIDE_CONFIG[cmd.camera_side].label}
                  </span>
                  <span className="text-textSecondary flex-1">{timeAgo(cmd.created_at)}</span>
                  <span className="text-accentRed/70 truncate max-w-[200px]">{cmd.error_message || 'Error tidak diketahui'}</span>
                  <button onClick={() => handleDelete(cmd)} className="p-1 text-textSecondary/40 hover:text-accentRed transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Photo grid */}
          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {photos.map(cmd => {
                const sideCfg = SIDE_CONFIG[cmd.camera_side];
                const url = signedUrls[cmd.id];
                const isLoadingUrl = loadingUrls.has(cmd.id);
                return (
                  <div key={cmd.id} className="glass-card rounded-xl overflow-hidden group hover:border-accentViolet/50 transition-all hover:scale-[1.02] relative">
                    <div className="relative aspect-[3/4] bg-darkBg/50 overflow-hidden cursor-pointer" onClick={() => openLightbox(cmd)}>
                      {isLoadingUrl && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 size={20} className="animate-spin text-accentViolet" />
                        </div>
                      )}
                      {url ? (
                        <img src={url} alt={`cam-${cmd.id}`}
                          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : !isLoadingUrl ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                          <Aperture size={20} className="text-textSecondary/40" />
                          <span className="text-[9px] text-textSecondary/40">No preview</span>
                        </div>
                      ) : null}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn size={24} className="text-white" />
                      </div>
                      {/* Delete overlay */}
                      <button onClick={e => { e.stopPropagation(); handleDelete(cmd); }} disabled={deletingIds.has(cmd.id)}
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-600/80 transition-all disabled:opacity-30 z-10">
                        {deletingIds.has(cmd.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                    <div className="p-2 space-y-1">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${sideCfg.bg} ${sideCfg.color} ${sideCfg.border}`}>
                        {sideCfg.label}
                      </span>
                      <p className="text-[10px] text-textSecondary">{cmd.executed_at ? timeAgo(cmd.executed_at) : timeAgo(cmd.created_at)}</p>
                      {cmd.file_size_bytes && <p className="text-[9px] text-textSecondary/50">{formatBytes(cmd.file_size_bytes)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && lightboxCmd && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => { setLightboxUrl(null); setLightboxCmd(null); }}>
          <div onClick={e => e.stopPropagation()} className="relative max-w-lg w-full space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${SIDE_CONFIG[lightboxCmd.camera_side].bg} ${SIDE_CONFIG[lightboxCmd.camera_side].color} ${SIDE_CONFIG[lightboxCmd.camera_side].border}`}>
                  Kamera {SIDE_CONFIG[lightboxCmd.camera_side].label}
                </span>
                <span className="text-xs text-gray-400">
                  {lightboxCmd.executed_at ? new Date(lightboxCmd.executed_at).toLocaleString('id-ID') : ''}
                  {lightboxCmd.file_size_bytes ? ` · ${formatBytes(lightboxCmd.file_size_bytes)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDelete(lightboxCmd)} disabled={deletingIds.has(lightboxCmd.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50">
                  {deletingIds.has(lightboxCmd.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Hapus
                </button>
                <a href={lightboxUrl} download target="_blank"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all">
                  <Download size={12} /> Download
                </a>
                <button onClick={() => { setLightboxUrl(null); setLightboxCmd(null); }}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
            <img src={lightboxUrl} alt="camera" className="w-full rounded-xl max-h-[70vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
