'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Camera, RefreshCw, Loader2, AlertTriangle, Download, ZoomIn, X, Zap, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Screenshot {
  id: number;
  device_id: string;
  storage_path: string;
  trigger_reason: string;
  file_size_bytes: number;
  captured_at: string;
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

const TRIGGER_CONFIG: Record<string, { label: string; colorClass: string }> = {
  SCHEDULED:       { label: 'Terjadwal',  colorClass: 'bg-accentBlue/15 text-accentBlue border border-accentBlue/30' },
  KEYWORD_TRIGGER: { label: 'Kata Kunci', colorClass: 'bg-accentRed/15 text-accentRed border border-accentRed/30' },
  MANUAL:          { label: 'Manual',     colorClass: 'bg-accentGreen/15 text-accentGreen border border-accentGreen/30' },
};

export default function ScreenshotsPage() {
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [device, setDevice]           = useState<any>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [signedUrls, setSignedUrls]   = useState<Record<number, string>>({});
  const [error, setError]             = useState<string | null>(null);
  const [dateFilter, setDateFilter]   = useState<DateFilter>('7d');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxInfo, setLightboxInfo] = useState<Screenshot | null>(null);
  const [loadingUrls, setLoadingUrls] = useState<Set<number>>(new Set());
  const [triggeringScreenshot, setTriggeringScreenshot] = useState(false);
  const [triggerSuccess, setTriggerSuccess] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const handleDelete = async (s: Screenshot) => {
    setDeletingIds(prev => new Set(prev).add(s.id));
    if (lightboxInfo?.id === s.id) { setLightboxUrl(null); setLightboxInfo(null); }
    setScreenshots(prev => prev.filter(ss => ss.id !== s.id));
    await supabase.from('screenshots').delete().eq('id', s.id);
    if (s.storage_path) {
      await supabase.storage.from('screenshots').remove([s.storage_path]);
    }
    setDeletingIds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
  };

  const handleTriggerScreenshot = async () => {
    if (!device || triggeringScreenshot) return;
    setTriggeringScreenshot(true);
    setTriggerSuccess(false);
    try {
      const { error } = await supabase
        .from('screenshot_commands')
        .insert({ device_id: device.id, status: 'PENDING' });
      if (error) throw error;
      setTriggerSuccess(true);
      setTimeout(() => setTriggerSuccess(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengirim perintah screenshot');
    } finally {
      setTriggeringScreenshot(false);
    }
  };

  const getSince = (f: DateFilter) => {
    const d = f === '1d' ? 1 : f === '7d' ? 7 : 30;
    return new Date(Date.now() - d * 86400000).toISOString();
  };

  const fetchSignedUrls = useCallback(async (items: Screenshot[]) => {
    const toFetch = items.filter(s => !signedUrls[s.id]);
    if (toFetch.length === 0) return;
    setLoadingUrls(prev => { const n = new Set(prev); toFetch.forEach(s => n.add(s.id)); return n; });
    const results: Record<number, string> = {};
    await Promise.all(
      toFetch.map(async (s) => {
        try {
          const { data } = await supabase.storage
            .from('screenshots')
            .createSignedUrl(s.storage_path, 3600);
          if (data?.signedUrl) results[s.id] = data.signedUrl;
          else {
            const { data: pub } = supabase.storage.from('screenshots').getPublicUrl(s.storage_path);
            if (pub?.publicUrl) results[s.id] = pub.publicUrl;
          }
        } catch (_) {}
      })
    );
    setSignedUrls(prev => ({ ...prev, ...results }));
    setLoadingUrls(prev => { const n = new Set(prev); toFetch.forEach(s => n.delete(s.id)); return n; });
  }, [signedUrls]);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error: e } = await supabase
        .from('screenshots')
        .select('*')
        .eq('device_id', target.id)
        .gte('captured_at', getSince(dateFilter))
        .order('captured_at', { ascending: false })
        .limit(200);
      if (e) throw e;
      const items = data || [];
      setScreenshots(items);
      setError(null);
      await fetchSignedUrls(items.slice(0, 20));
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data');
    } finally {
      setRefreshing(false);
    }
  }, [device, dateFilter, fetchSignedUrls]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  useEffect(() => { fetchData(); }, [dateFilter]);

  useEffect(() => {
    if (!device) return;
    const ch = supabase.channel(`screenshots-${device.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'screenshots', filter: `device_id=eq.${device.id}` },
        () => fetchData(device, true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [device, fetchData]);

  const openLightbox = async (s: Screenshot) => {
    let url = signedUrls[s.id];
    if (!url) {
      const { data } = await supabase.storage.from('screenshots').createSignedUrl(s.storage_path, 3600);
      url = data?.signedUrl || '';
      if (url) setSignedUrls(prev => ({ ...prev, [s.id]: url }));
    }
    setLightboxUrl(url);
    setLightboxInfo(s);
  };

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      // Delete storage files
      const { data: rows } = await supabase.from('screenshots').select('storage_path').eq('device_id', device.id);
      if (rows && rows.length > 0) {
        const paths = rows.map((r: any) => r.storage_path).filter(Boolean);
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage.from('screenshots').remove(paths.slice(i, i + 100));
        }
      }
      // Delete DB rows
      await supabase.from('screenshots').delete().eq('device_id', device.id);
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
      <p className="text-sm">Memuat galeri screenshot...</p>
    </div>
  );

  const triggerCounts = screenshots.reduce((acc: Record<string, number>, s) => {
    acc[s.trigger_reason] = (acc[s.trigger_reason] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Screenshot Layar</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Tangkapan layar via MediaProjection · {screenshots.length} gambar
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['1d','7d','30d'] as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${dateFilter === f ? 'bg-accentViolet text-white' : 'glass-card text-textSecondary hover:text-textPrimary'}`}>
              {f === '1d' ? 'Hari Ini' : f === '7d' ? '7 Hari' : '30 Hari'}
            </button>
          ))}
          <button
            onClick={handleTriggerScreenshot}
            disabled={triggeringScreenshot || !device}
            title="Kirim perintah screenshot manual ke perangkat"
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
              triggerSuccess
                ? 'bg-accentGreen/15 text-accentGreen border-accentGreen/40'
                : 'bg-accentViolet/10 text-violetLight border-accentViolet/30 hover:bg-accentViolet/20'
            } disabled:opacity-50`}
          >
            {triggeringScreenshot
              ? <Loader2 size={14} className="animate-spin" />
              : <Zap size={14} />}
            {triggerSuccess ? 'Terkirim!' : 'Screenshot Sekarang'}
          </button>
          <button onClick={() => fetchData()} className="p-2.5 glass-card hover:border-borderDark rounded-xl text-textSecondary hover:text-textPrimary">
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Screenshot'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs font-mono">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: screenshots.length, color: 'text-accentViolet' },
          { label: 'Terjadwal', value: triggerCounts['SCHEDULED'] || 0, color: 'text-accentBlue' },
          { label: 'Kata Kunci', value: triggerCounts['KEYWORD_TRIGGER'] || 0, color: 'text-accentRed' },
          { label: 'Manual', value: triggerCounts['MANUAL'] || 0, color: 'text-accentGreen' },
        ].map((s, i) => (
          <div key={i} className="glass-card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-textSecondary uppercase tracking-wider mt-1 font-semibold">{s.label}</p>
          </div>
        ))}
      </div>

      {screenshots.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center space-y-3">
          <Camera size={40} className="text-textSecondary mx-auto" />
          <p className="text-sm text-textSecondary">Belum ada screenshot untuk periode ini.</p>
          <p className="text-xs text-textSecondary/60">Screenshot muncul saat ScreenshotCaptureService aktif di perangkat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {screenshots.map((s) => {
            const trigger = TRIGGER_CONFIG[s.trigger_reason] || { label: s.trigger_reason, colorClass: 'bg-gray-600/15 text-gray-400 border border-gray-600/30' };
            const url = signedUrls[s.id];
            const isLoading = loadingUrls.has(s.id);
            return (
              <div key={s.id} className="glass-card rounded-xl overflow-hidden group hover:border-accentViolet/50 transition-all hover:scale-[1.02] relative">
                <div className="relative aspect-video bg-darkBg/50 overflow-hidden cursor-pointer" onClick={() => openLightbox(s)}>
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-accentViolet" />
                    </div>
                  )}
                  {url ? (
                    <img src={url} alt={`ss-${s.id}`}
                      className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : !isLoading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <Camera size={20} className="text-textSecondary/40" />
                      <span className="text-[9px] text-textSecondary/40">No preview</span>
                    </div>
                  ) : null}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ZoomIn size={24} className="text-white" />
                  </div>
                  {/* Delete button overlay */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
                    disabled={deletingIds.has(s.id)}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-600/80 transition-all disabled:opacity-30 z-10"
                    title="Hapus screenshot ini"
                  >
                    {deletingIds.has(s.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
                <div className="p-2.5 space-y-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${trigger.colorClass}`}>
                    {trigger.label}
                  </span>
                  <p className="text-[10px] text-textSecondary">{timeAgo(s.captured_at)}</p>
                  <p className="text-[9px] text-textSecondary/50">{formatBytes(s.file_size_bytes)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && lightboxInfo && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => { setLightboxUrl(null); setLightboxInfo(null); }}>
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-4xl w-full space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${(TRIGGER_CONFIG[lightboxInfo.trigger_reason] || TRIGGER_CONFIG.SCHEDULED).colorClass}`}>
                  {(TRIGGER_CONFIG[lightboxInfo.trigger_reason] || { label: lightboxInfo.trigger_reason }).label}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(lightboxInfo.captured_at).toLocaleString('id-ID')} · {formatBytes(lightboxInfo.file_size_bytes)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDelete(lightboxInfo)}
                  disabled={deletingIds.has(lightboxInfo.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50"
                >
                  {deletingIds.has(lightboxInfo.id) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Hapus
                </button>
                <a href={lightboxUrl} download target="_blank"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all"
                >
                  <Download size={12} /> Download
                </a>
                <button
                  onClick={() => { setLightboxUrl(null); setLightboxInfo(null); }}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <img src={lightboxUrl} alt="screenshot" className="w-full rounded-xl max-h-[70vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
