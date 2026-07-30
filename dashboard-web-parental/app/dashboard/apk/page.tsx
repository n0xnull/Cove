'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Package, Upload, Download, Trash2, Loader2, AlertCircle,
  RefreshCw, FileArchive, CheckCircle2, Info,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

function formatBytes(b: number) {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ApkPage() {
  const [apkFiles, setApkFiles]         = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [uploading, setUploading]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [successMsg, setSuccessMsg]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchApks = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error: e } = await supabase.storage
        .from('apk-releases')
        .list('', { sortBy: { column: 'created_at', order: 'desc' } });
      if (e) throw e;
      setApkFiles((data || []).filter((f: any) => f.name.endsWith('.apk')));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat daftar APK');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchApks(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.apk')) { setError('Hanya file .apk yang diizinkan'); return; }
    setUploading(true); setError(null); setSuccessMsg(null); setUploadProgress(0);
    try {
      const { error: upErr } = await supabase.storage
        .from('apk-releases')
        .upload(file.name, file, { upsert: true, contentType: 'application/vnd.android.package-archive' });
      if (upErr) throw upErr;
      setSuccessMsg(`"${file.name}" berhasil diupload!`);
      setTimeout(() => setSuccessMsg(null), 5000);
      await fetchApks(true);
    } catch (err: any) {
      setError(err?.message ?? 'Upload gagal');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (fileName: string) => {
    try {
      const { data } = await supabase.storage.from('apk-releases').createSignedUrl(fileName, 3600);
      if (data?.signedUrl) {
        const a = document.createElement('a');
        a.href = data.signedUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err: any) { setError(err?.message ?? 'Download gagal'); }
  };

  const handleDelete = async (fileName: string) => {
    if (confirmDelete !== fileName) { setConfirmDelete(fileName); return; }
    setDeletingName(fileName); setConfirmDelete(null);
    try {
      await supabase.storage.from('apk-releases').remove([fileName]);
      await fetchApks(true);
    } catch (err: any) { setError(err?.message ?? 'Hapus gagal'); }
    finally { setDeletingName(null); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Unduh APK Agent</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Kelola dan distribusikan APK aplikasi Cove ke HP anak
          </p>
        </div>
        <button onClick={() => fetchApks()} className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="flex gap-3 p-4 bg-accentGreen/10 border border-accentGreen/30 rounded-xl">
          <CheckCircle2 size={16} className="text-accentGreen shrink-0 mt-0.5" />
          <p className="text-accentGreen text-xs font-semibold">{successMsg}</p>
        </div>
      )}

      {/* Upload card */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Upload size={16} className="text-accentViolet" /> Upload Versi APK
        </h2>
        <p className="text-xs text-textSecondary leading-relaxed">
          Build APK dari Android Studio (<code>Build → Generate Signed APK</code>), lalu upload di sini.
          File lama akan digantikan jika namanya sama.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".apk"
          onChange={handleUpload}
          className="hidden"
          id="apk-file-input"
          disabled={uploading}
        />
        <label
          htmlFor="apk-file-input"
          className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all ${
            uploading
              ? 'bg-accentViolet/30 text-white/50 cursor-not-allowed'
              : 'bg-accentViolet text-white hover:bg-accentViolet/80'
          }`}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {uploading ? 'Mengupload APK...' : 'Pilih File .apk'}
        </label>
      </div>

      {/* APK list */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-borderDark/50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider">
            Versi Tersedia
          </h2>
          {apkFiles.length > 0 && (
            <span className="text-[10px] text-textSecondary/60">{apkFiles.length} file</span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-textSecondary">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Memuat...</span>
          </div>
        ) : apkFiles.length === 0 ? (
          <div className="flex flex-col items-center py-14 gap-3 text-textSecondary/40">
            <FileArchive size={40} />
            <p className="text-xs">Belum ada APK. Upload file .apk pertama kamu.</p>
          </div>
        ) : (
          <div className="divide-y divide-borderDark/20">
            {apkFiles.map((file, idx) => (
              <div key={file.name}
                className={`flex items-center gap-4 px-5 py-4 ${idx === 0 ? 'bg-accentBlue/5' : 'hover:bg-cardBg/30'} transition-colors`}>
                <div className={`p-2.5 rounded-xl shrink-0 ${idx === 0 ? 'bg-accentBlue/15' : 'bg-cardBg'}`}>
                  <Package size={18} className={idx === 0 ? 'text-accentBlue' : 'text-textSecondary/40'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-textPrimary truncate">{file.name}</p>
                    {idx === 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accentBlue/20 text-accentBlue uppercase tracking-wide shrink-0">
                        Terbaru
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-textSecondary mt-0.5">
                    {formatBytes(file.metadata?.size ?? 0)} · {formatDate(file.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleDownload(file.name)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accentBlue/15 text-accentBlue border border-accentBlue/25 hover:bg-accentBlue/25 text-xs font-bold transition-all">
                    <Download size={12} /> Unduh
                  </button>
                  <button
                    onClick={() => handleDelete(file.name)}
                    disabled={deletingName === file.name}
                    onMouseLeave={() => setConfirmDelete(null)}
                    className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 ${
                      confirmDelete === file.name
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'glass-card text-textSecondary/50 hover:text-accentRed hover:bg-red-950/20'
                    }`}
                  >
                    {deletingName === file.name
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Trash2 size={12} />}
                    {confirmDelete === file.name ? 'Yakin?' : ''}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="glass-card rounded-2xl p-5 space-y-3 border border-borderDark/30">
        <p className="text-xs font-bold text-textSecondary uppercase tracking-wider flex items-center gap-1.5">
          <Info size={12} /> Catatan
        </p>
        <ul className="space-y-1.5 text-[11px] text-textSecondary/80">
          <li>• Bucket Supabase yang digunakan: <code className="text-violetLight">apk-releases</code> (buat manual jika belum ada)</li>
          <li>• Setelah install APK di HP anak, buka <strong>Daftar Anak</strong> di sidebar untuk mendapatkan PIN pairing</li>
          <li>• Satu APK universal untuk semua anak — konfigurasi dilakukan lewat PIN saat setup pertama</li>
          <li>• Aktifkan "Sumber Tidak Dikenal" di HP anak sebelum install</li>
        </ul>
      </div>
    </div>
  );
}
