'use client';

import React, { useEffect, useState } from 'react';
import { Play, Ban, Loader2, Smartphone, RefreshCw, AlertTriangle, CheckCircle2, Package, Search, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface InstalledApp {
  id: string;
  app_name: string;
  app_package: string;
  install_source: string;
  is_suspicious: boolean;
  is_uninstalled: boolean;
}

interface AppRule {
  app_package: string;
  is_blocked: boolean;
}

type FilterMode = 'all' | 'suspicious' | 'store';

export default function AppInventoryPage() {
  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<any>(null);
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const [triggeringSync, setTriggeringSync] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const fetchAppsData = async () => {
    setLoading(true);
    try {
      const { data: devicesData } = await supabase
        .from('devices')
        .select('*')
        .order('created_at', { ascending: false });

      if (devicesData && devicesData.length > 0) {
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const activeDevice = devicesData.find(d => d.id === savedId) || devicesData[0];
        setDevice(activeDevice);

        const [appsRes, rulesRes] = await Promise.all([
          supabase.from('installed_apps').select('*').eq('device_id', activeDevice.id).eq('is_uninstalled', false).order('app_name', { ascending: true }),
          supabase.from('app_rules').select('app_package, is_blocked').eq('device_id', activeDevice.id),
        ]);

        if (!appsRes.error && appsRes.data) setApps(appsRes.data);
        if (!rulesRes.error && rulesRes.data) {
          const map: Record<string, boolean> = {};
          rulesRes.data.forEach(r => { map[r.app_package] = r.is_blocked; });
          setRules(map);
        }
      }
    } catch (err) {
      console.error(err);
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
          command_type: 'APPS',
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
            fetchAppsData();
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

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { fetchAppsData(); }, []);

  const handleToggleBlock = async (app: InstalledApp) => {
    if (!device) return;
    const newStatus = !rules[app.app_package];
    setTogglingId(app.id);
    try {
      const { error } = await supabase.from('app_rules').upsert(
        { device_id: device.id, app_package: app.app_package, app_name: app.app_name, is_blocked: newStatus, daily_limit_seconds: 0 },
        { onConflict: 'device_id,app_package' }
      );
      if (!error) setRules(prev => ({ ...prev, [app.app_package]: newStatus }));
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingId(null);
    }
  };

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat inventaris aplikasi...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="space-y-8">
        <div><h1 className="text-3xl font-bold">Inventaris Aplikasi & Kebijakan</h1></div>
        <div className="glass-card rounded-2xl p-8 text-center max-w-2xl mx-auto space-y-4">
          <Smartphone size={40} className="text-accentViolet mx-auto" />
          <p className="text-textSecondary text-sm">Hubungkan perangkat anak untuk melihat daftar aplikasi.</p>
        </div>
      </div>
    );
  }

  // V2: Stat counts
  const suspicious = apps.filter(a => a.is_suspicious);
  const fromStore  = apps.filter(a => !a.is_suspicious);

  // Filter + search
  const filtered = apps.filter(app => {
    const matchSearch = app.app_name.toLowerCase().includes(search.toLowerCase()) ||
                        app.app_package.toLowerCase().includes(search.toLowerCase());
    if (filter === 'suspicious') return app.is_suspicious && matchSearch;
    if (filter === 'store')      return !app.is_suspicious && matchSearch;
    return matchSearch;
  });

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('installed_apps').delete().eq('device_id', device.id);
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
          <h1 className="text-3xl font-bold tracking-tight">Inventaris Aplikasi & Kebijakan</h1>
          <p className="text-textSecondary mt-1">
            {device.device_name} · {apps.length} aplikasi terpasang
          </p>
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
            className="flex items-center gap-2 px-4 py-2 glass-card rounded-xl hover:border-borderDark disabled:opacity-50 transition-colors text-sm font-semibold"
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Aplikasi'}
          </button>
        </div>
      </div>

      {/* V2: Stat bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <span className="p-2 bg-accentViolet/10 text-violetLight rounded-lg"><Package size={18} /></span>
          <div>
            <p className="text-2xl font-bold">{apps.length}</p>
            <p className="text-xs text-textSecondary">Total Aplikasi</p>
          </div>
        </div>
        <div className={`glass-card rounded-xl p-4 flex items-center gap-3 ${suspicious.length > 0 ? 'border-accentOrange/30' : ''}`}>
          <span className={`p-2 rounded-lg ${suspicious.length > 0 ? 'bg-accentOrange/10 text-accentOrange' : 'bg-cardBg text-textSecondary'}`}>
            <AlertTriangle size={18} />
          </span>
          <div>
            <p className={`text-2xl font-bold ${suspicious.length > 0 ? 'text-accentOrange' : ''}`}>{suspicious.length}</p>
            <p className="text-xs text-textSecondary">Sideload / Mencurigakan</p>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <span className="p-2 bg-accentGreen/10 text-accentGreen rounded-lg"><CheckCircle2 size={18} /></span>
          <div>
            <p className="text-2xl font-bold text-accentGreen">{fromStore.length}</p>
            <p className="text-xs text-textSecondary">Dari Play Store</p>
          </div>
        </div>
      </div>

      {/* V2: Filter tabs + search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2">
          {(['all', 'suspicious', 'store'] as FilterMode[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
                filter === f
                  ? 'bg-accentViolet/15 text-violetLight border-accentViolet/40'
                  : 'glass-card text-textSecondary hover:text-textPrimary'
              }`}
            >
              {f === 'all' ? 'Semua' : f === 'suspicious' ? `⚠️ Sideload (${suspicious.length})` : `✓ Play Store (${fromStore.length})`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
          <input
            type="text"
            placeholder="Cari nama atau paket..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-darkBg border border-borderDark rounded-lg pl-9 pr-4 py-2 text-xs text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet"
          />
        </div>
      </div>

      {/* App Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-textSecondary text-center py-10">
            {apps.length === 0 ? 'Data aplikasi belum tersedia.' : 'Tidak ada aplikasi yang cocok dengan filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-borderDark text-textSecondary text-xs font-semibold bg-darkBg/40">
                  <th className="pb-3 pt-4 px-5">Nama Aplikasi</th>
                  <th className="pb-3 pt-4 px-5">Sumber Instalasi</th>
                  <th className="pb-3 pt-4 px-5">Status Kontrol</th>
                  <th className="pb-3 pt-4 px-5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderDark/30">
                {filtered.map((app) => {
                  const isBlocked = !!rules[app.app_package];
                  return (
                    <tr key={app.id} className={`hover:bg-cardBg/30 transition-colors ${app.is_suspicious ? 'bg-accentOrange/3' : ''}`}>
                      <td className="py-4 px-5">
                        <div className="font-semibold text-textPrimary text-sm">{app.app_name}</div>
                        <div className="text-[11px] text-textSecondary font-mono mt-0.5">{app.app_package}</div>
                      </td>
                      <td className="py-4 px-5">
                        {app.is_suspicious ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-accentOrange/10 text-accentOrange border border-accentOrange/30 animate-pulse">
                            <AlertTriangle size={10} /> SIDELOAD
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accentGreen/10 text-accentGreen border border-accentGreen/20">
                            ✓ Play Store
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5">
                        {isBlocked ? (
                          <span className="text-xs font-bold text-accentRed flex items-center gap-1.5"><Ban size={12} /> Terblokir</span>
                        ) : (
                          <span className="text-xs font-bold text-accentGreen flex items-center gap-1.5"><Play size={12} /> Diizinkan</span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          disabled={togglingId === app.id}
                          onClick={() => handleToggleBlock(app)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors inline-flex items-center gap-1.5
                            ${isBlocked
                              ? 'bg-accentGreen/10 text-accentGreen border-accentGreen/30 hover:bg-accentGreen/20'
                              : 'bg-accentRed/10 text-accentRed border-accentRed/30 hover:bg-accentRed/20'
                            }`}
                        >
                          {togglingId === app.id && <Loader2 className="animate-spin" size={10} />}
                          {isBlocked ? 'Izinkan' : 'Blokir'}
                        </button>
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
