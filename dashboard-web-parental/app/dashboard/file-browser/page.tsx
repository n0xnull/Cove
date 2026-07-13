'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  HardDrive, Folder, File, FolderOpen, RefreshCw, Loader2,
  AlertTriangle, ChevronRight, Home, ArrowLeft, Music, Image,
  Film, FileText, Archive, Package, Code2, Search, X, Trash2,
  Download, CheckCircle, Clock, XCircle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface FileEntry {
  id: number;
  device_id: string;
  file_path: string;
  file_name: string;
  parent_path: string;
  file_size_bytes: number;
  is_directory: boolean;
  mime_type: string;
  last_modified: string | null;
  synced_at: string;
}

interface TransferCommand {
  id: number;
  file_path: string;
  status: 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED';
  storage_path: string | null;
  error_message: string | null;
}

function formatBytes(b: number) {
  if (!b || b === 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getMimeIcon(mime: string, isDir: boolean) {
  if (isDir) return null;
  if (mime.startsWith('image/'))  return <Image  size={14} className="text-accentBlue shrink-0" />;
  if (mime.startsWith('audio/'))  return <Music  size={14} className="text-accentGreen shrink-0" />;
  if (mime.startsWith('video/'))  return <Film   size={14} className="text-accentViolet shrink-0" />;
  if (mime.startsWith('text/'))   return <FileText size={14} className="text-textSecondary shrink-0" />;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar'))
    return <Archive size={14} className="text-accentYellow shrink-0" />;
  if (mime.includes('apk') || mime.includes('android'))
    return <Package size={14} className="text-accentRed shrink-0" />;
  if (mime.includes('json') || mime.includes('xml') || mime.includes('javascript'))
    return <Code2   size={14} className="text-accentGreen shrink-0" />;
  return <File size={14} className="text-textSecondary/60 shrink-0" />;
}

const DEFAULT_ROOT = '/storage/emulated/0';

/** Temukan root path sebenarnya dari data — path parent terpendek yang ada */
function detectRoot(entries: FileEntry[]): string {
  if (entries.length === 0) return DEFAULT_ROOT;
  // Kumpulkan semua parent_path unik
  const parentPaths = [...new Set(entries.map(e => e.parent_path).filter(Boolean))];
  if (parentPaths.length === 0) return DEFAULT_ROOT;
  // Root = parent_path terpendek (paling dekat ke root)
  const shortest = parentPaths.reduce((a, b) => a.length <= b.length ? a : b);
  // Hapus trailing slash jika ada
  return shortest.replace(/\/$/, '') || DEFAULT_ROOT;
}

export default function FileBrowserPage() {
  const [loading, setLoading]         = useState(true);
  const [device, setDevice]           = useState<any>(null);
  const [allEntries, setAllEntries]   = useState<FileEntry[]>([]);
  const [rootPath, setRootPath]       = useState(DEFAULT_ROOT);
  const [currentPath, setCurrentPath] = useState(DEFAULT_ROOT);
  const [error, setError]             = useState<string | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [search, setSearch]           = useState('');
  const [synced, setSynced]           = useState<string | null>(null);

  // Transfer command states
  const [transfers, setTransfers]           = useState<Record<string, TransferCommand>>({});  // key = file_path
  const [requestingPaths, setRequestingPaths] = useState<Set<string>>(new Set());

  // Clear All
  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchAllEntries = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      let all: FileEntry[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error: e } = await supabase
          .from('file_entries').select('*')
          .eq('device_id', target.id)
          .order('is_directory', { ascending: false })
          .order('file_name',    { ascending: true })
          .range(from, from + PAGE - 1);
        if (e) throw e;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      setAllEntries(all);
      if (all.length > 0) {
        setSynced(all[0].synced_at);
        // Auto-detect root dari data aktual agar list langsung tampil
        const detectedRoot = detectRoot(all);
        setRootPath(detectedRoot);
        setCurrentPath(detectedRoot);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data');
    } finally {
      setRefreshing(false);
    }
  }, [device]);

  // Load recent transfer commands for this device
  const fetchTransfers = useCallback(async (dev?: any) => {
    const target = dev || device;
    if (!target) return;
    const { data } = await supabase
      .from('file_transfer_commands')
      .select('id, file_path, status, storage_path, error_message')
      .eq('device_id', target.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!data) return;
    const map: Record<string, TransferCommand> = {};
    for (const row of data) {
      // Keep only most recent per file_path
      if (!map[row.file_path]) map[row.file_path] = row as TransferCommand;
    }
    setTransfers(map);
    return map;
  }, [device]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) return;
        const saved = localStorage.getItem('selected_device_id');
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await Promise.all([fetchAllEntries(dev, true), fetchTransfers(dev)]);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  // Realtime: listen for transfer command updates
  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel(`file-transfers-${device.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'file_transfer_commands',
        filter: `device_id=eq.${device.id}`
      }, (payload) => {
        const row = payload.new as TransferCommand;
        if (!row?.file_path) return;
        setTransfers(prev => {
          const existing = prev[row.file_path];
          // Only update if this row is newer (higher id) or same id
          if (existing && existing.id > row.id) return prev;
          return { ...prev, [row.file_path]: row };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [device]);

  // Polling fallback: kalau ada transfer PENDING/EXECUTING, poll setiap 5 detik
  // (antisipasi realtime belum diaktifkan di Supabase)
  useEffect(() => {
    if (!device) return;
    const hasPending = Object.values(transfers).some(
      t => t.status === 'PENDING' || t.status === 'EXECUTING'
    );
    if (!hasPending) return;
    const interval = setInterval(() => fetchTransfers(), 5000);
    return () => clearInterval(interval);
  }, [device, transfers, fetchTransfers]);

  // Request file download from device
  const requestDownload = useCallback(async (entry: FileEntry) => {
    if (!device) return;
    const path = entry.file_path;
    setRequestingPaths(prev => new Set(prev).add(path));
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('file_transfer_commands')
        .insert({
          device_id: device.id,
          file_path: path,
          file_name: entry.file_name,
          mime_type: entry.mime_type || '',
          status: 'PENDING',
        })
        .select('id, file_path, status, storage_path, error_message')
        .single();
      if (e) throw e;
      if (data) {
        setTransfers(prev => ({ ...prev, [path]: data as TransferCommand }));
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Gagal meminta unduhan';
      console.error('Request download failed', err);
      // RLS error biasanya kode 42501 atau message mengandung "policy"
      if (msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('permission') || msg.includes('42501')) {
        setError(`RLS Error: Tabel file_transfer_commands belum punya policy INSERT. Jalankan SQL fix di Supabase. (${msg})`);
      } else {
        setError(`Gagal meminta unduhan: ${msg}`);
      }
    } finally {
      setRequestingPaths(prev => { const n = new Set(prev); n.delete(path); return n; });
    }
  }, [device]);

  // Open / download completed file
  const openDownload = useCallback(async (storagePath: string, fileName: string) => {
    setError(null);
    try {
      // Coba signed URL dulu (untuk bucket private)
      const { data, error: e } = await supabase.storage
        .from('file-transfers')
        .createSignedUrl(storagePath, 3600);
      if (!e && data?.signedUrl) {
        const a = document.createElement('a');
        a.href = data.signedUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      // Fallback: public URL (jika bucket diset public)
      const { data: pub } = supabase.storage.from('file-transfers').getPublicUrl(storagePath);
      if (pub?.publicUrl) {
        const a = document.createElement('a');
        a.href = pub.publicUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      throw e ?? new Error('URL tidak tersedia — pastikan bucket file-transfers sudah dibuat di Supabase');
    } catch (err: any) {
      const msg = err?.message ?? 'Gagal mengunduh file';
      console.error('Download failed', err);
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')) {
        setError(`Bucket "file-transfers" belum ada di Supabase Storage. Buat bucket tersebut terlebih dahulu.`);
      } else {
        setError(`Gagal mengunduh: ${msg}`);
      }
    }
  }, []);

  const currentItems = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return allEntries.filter(e => e.file_name.toLowerCase().includes(q));
    }
    return allEntries.filter(e => e.parent_path === currentPath);
  }, [allEntries, currentPath, search]);

  const breadcrumbs = useMemo(() => {
    const rel = currentPath.startsWith(rootPath) ? currentPath.slice(rootPath.length) : currentPath;
    const parts = rel.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: 'Penyimpanan', path: rootPath }];
    let acc = rootPath;
    for (const part of parts) { acc = acc + '/' + part; crumbs.push({ label: part, path: acc }); }
    return crumbs;
  }, [currentPath, rootPath]);

  const navigateTo = (path: string) => { setSearch(''); setCurrentPath(path); };
  const goUp = () => {
    if (currentPath === rootPath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || rootPath;
    navigateTo(parent.startsWith(rootPath) ? parent : rootPath);
  };

  const stats = useMemo(() => {
    const files = allEntries.filter(e => !e.is_directory);
    const dirs  = allEntries.filter(e => e.is_directory);
    return { files: files.length, dirs: dirs.length, totalSize: files.reduce((s, f) => s + (f.file_size_bytes || 0), 0) };
  }, [allEntries]);

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true); setConfirmClear(false);
    try {
      await supabase.from('file_entries').delete().eq('device_id', device.id);
      setAllEntries([]); setSynced(null);
    } catch (err: any) { console.error('Clear all failed', err); }
    finally { setClearingAll(false); }
  };

  // Transfer status badge per file
  const TransferBadge = ({ entry }: { entry: FileEntry }) => {
    const tr = transfers[entry.file_path];
    const isRequesting = requestingPaths.has(entry.file_path);

    if (isRequesting) return (
      <span className="flex items-center gap-1 text-[10px] text-textSecondary">
        <Loader2 size={11} className="animate-spin" /> Meminta...
      </span>
    );

    if (!tr) return (
      <button
        onClick={e => { e.stopPropagation(); requestDownload(entry); }}
        title="Unduh file dari perangkat"
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-accentViolet/10 text-violetLight hover:bg-accentViolet/20 border border-accentViolet/20 transition-all"
      >
        <Download size={10} /> Unduh
      </button>
    );

    if (tr.status === 'PENDING' || tr.status === 'EXECUTING') return (
      <span className="flex items-center gap-1 text-[10px] text-accentYellow/80 animate-pulse">
        <Clock size={10} />
        {tr.status === 'EXECUTING' ? 'Mengupload...' : 'Menunggu...'}
      </span>
    );

    if (tr.status === 'DONE' && tr.storage_path) return (
      <button
        onClick={e => { e.stopPropagation(); openDownload(tr.storage_path!, entry.file_name); }}
        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-accentGreen/10 text-accentGreen hover:bg-accentGreen/20 border border-accentGreen/20 transition-all"
      >
        <CheckCircle size={10} /> Simpan
      </button>
    );

    if (tr.status === 'FAILED') return (
      <button
        onClick={e => { e.stopPropagation(); requestDownload(entry); }}
        title={tr.error_message ?? 'Gagal'}
        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-red-950/30 text-accentRed hover:bg-red-950/50 border border-red-900/30 transition-all"
      >
        <XCircle size={10} /> Coba Lagi
      </button>
    );

    return null;
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
      <Loader2 className="animate-spin text-accentViolet" size={36} />
      <p className="text-sm">Memuat daftar file...</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">File Penyimpanan</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Jelajahi dan unduh file dari penyimpanan perangkat anak
            {synced && <span className="ml-2 text-[11px] text-textSecondary/50">· Disinkronkan {formatDate(synced)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAllEntries()} className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearingAll || !device}
            onMouseLeave={() => setConfirmClear(false)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${
              confirmClear ? 'bg-red-600 text-white animate-pulse'
                : 'glass-card text-accentRed/70 hover:bg-red-950/30 hover:text-accentRed border border-red-900/20'
            }`}
          >
            {clearingAll ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Data File'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      {/* Info cara pakai unduh */}
      <div className="flex items-start gap-3 p-3.5 bg-accentViolet/5 border border-accentViolet/15 rounded-xl">
        <Download size={14} className="text-violetLight mt-0.5 shrink-0" />
        <p className="text-[11px] text-textSecondary leading-relaxed">
          Hover pada baris file → klik <strong className="text-violetLight">Unduh</strong> → Android akan membaca dan mengupload file ke server → klik <strong className="text-accentGreen">Simpan</strong> untuk download ke komputer Anda. Maksimum 50 MB per file.
        </p>
      </div>

      {allEntries.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center space-y-3">
          <HardDrive size={40} className="text-textSecondary/20 mx-auto" />
          <p className="text-sm text-textSecondary font-medium">Data file belum tersedia.</p>
          <p className="text-xs text-textSecondary/60 max-w-sm mx-auto">
            Agent Android perlu melakukan sinkronisasi file terlebih dahulu. Sinkronisasi otomatis terjadi setiap 6 jam.
          </p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total File', value: stats.files.toLocaleString(), color: 'text-accentBlue'   },
              { label: 'Folder',     value: stats.dirs.toLocaleString(),  color: 'text-accentYellow' },
              { label: 'Total Size', value: formatBytes(stats.totalSize), color: 'text-accentGreen'  },
            ].map((s, i) => (
              <div key={i} className="glass-card rounded-xl p-4 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-textSecondary mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cari nama file atau folder..."
              className="w-full pl-9 pr-9 py-2.5 text-xs bg-darkBg border border-borderDark rounded-xl text-textPrimary placeholder-textSecondary/40 focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-textSecondary hover:text-textPrimary">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Breadcrumb */}
          {!search && (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={goUp} disabled={currentPath === rootPath}
                className="p-1.5 rounded-lg glass-card text-textSecondary hover:text-textPrimary disabled:opacity-30 disabled:cursor-default transition-all">
                <ArrowLeft size={14} />
              </button>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  {i > 0 && <ChevronRight size={12} className="text-textSecondary/30" />}
                  <button onClick={() => navigateTo(crumb.path)}
                    className={`text-xs px-2 py-1 rounded-lg transition-all ${
                      i === breadcrumbs.length - 1
                        ? 'text-violetLight font-semibold bg-accentViolet/10'
                        : 'text-textSecondary hover:text-textPrimary hover:bg-cardBg/60'
                    }`}>
                    {i === 0 ? <span className="flex items-center gap-1"><Home size={11} />Penyimpanan</span> : crumb.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {search && (
            <p className="text-xs text-textSecondary">
              Ditemukan <span className="text-textPrimary font-semibold">{currentItems.length}</span> item untuk "<span className="text-violetLight">{search}</span>"
            </p>
          )}

          {/* File list */}
          <div className="glass-card rounded-2xl overflow-hidden">
            {currentItems.length === 0 ? (
              <div className="p-10 text-center">
                <Folder size={32} className="text-textSecondary/20 mx-auto mb-2" />
                <p className="text-xs text-textSecondary">{search ? 'Tidak ada hasil.' : 'Folder kosong.'}</p>
              </div>
            ) : (
              <div className="divide-y divide-borderDark/20">
                {/* Header */}
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-2 bg-cardBg/40">
                  <div className="w-5" />
                  <span className="text-[10px] font-bold text-textSecondary uppercase tracking-wider">Nama</span>
                  <span className="text-[10px] font-bold text-textSecondary uppercase tracking-wider w-24 text-right">Aksi</span>
                  <span className="text-[10px] font-bold text-textSecondary uppercase tracking-wider w-20 text-right">Ukuran</span>
                  <span className="text-[10px] font-bold text-textSecondary uppercase tracking-wider w-24 text-right">Diubah</span>
                </div>
                {currentItems.map(entry => (
                  <div
                    key={entry.id}
                    onClick={() => entry.is_directory && !search ? navigateTo(entry.file_path) : undefined}
                    className={`group grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors ${
                      entry.is_directory ? 'cursor-pointer hover:bg-accentViolet/5' : 'hover:bg-cardBg/30'
                    }`}
                  >
                    {/* Icon */}
                    <div className="w-5 flex items-center justify-center">
                      {entry.is_directory
                        ? <><Folder size={15} className="text-accentYellow group-hover:hidden" /><FolderOpen size={15} className="text-accentYellow hidden group-hover:block" /></>
                        : getMimeIcon(entry.mime_type, false)
                      }
                    </div>

                    {/* Nama */}
                    <div className="min-w-0">
                      <p className={`text-xs font-medium truncate ${entry.is_directory ? 'text-textPrimary' : 'text-textSecondary'}`}>
                        {entry.file_name}
                      </p>
                      {search && <p className="text-[10px] text-textSecondary/50 truncate mt-0.5">{entry.parent_path}</p>}
                    </div>

                    {/* Tombol unduh (hanya file, bukan folder) */}
                    <div className="w-24 flex justify-end" onClick={e => e.stopPropagation()}>
                      {!entry.is_directory && <TransferBadge entry={entry} />}
                    </div>

                    {/* Ukuran */}
                    <span className="text-[10px] text-textSecondary w-20 text-right whitespace-nowrap">
                      {entry.is_directory ? '—' : formatBytes(entry.file_size_bytes)}
                    </span>

                    {/* Tanggal */}
                    <span className="text-[10px] text-textSecondary/60 w-24 text-right whitespace-nowrap">
                      {formatDate(entry.last_modified)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
