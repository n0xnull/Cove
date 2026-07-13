'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Search, Loader2, RefreshCw, FileText, ShieldAlert, Settings, X, Check, Smartphone, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface ScreenScrapedLog {
  id: string;
  app_package: string;
  scraped_text: string;
  is_suspicious: boolean;
  recorded_at: string;
}

interface InstalledApp {
  id: string;
  app_name: string;
  app_package: string;
}

const APP_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram',
  orca: 'Messenger', facebook: 'Messenger', tiktok: 'TikTok',
  musically: 'TikTok', snapchat: 'Snapchat', twitter: 'Twitter/X', linkedin: 'LinkedIn',
  gm: 'Gmail', outlook: 'Outlook',
};

const DEFAULT_OCR_PACKAGES = [
  "com.whatsapp",
  "com.whatsapp.w4b",
  "com.instagram.android",
  "org.telegram.messenger",
  "org.telegram.messenger.web",
  "com.facebook.orca",
  "com.facebook.katana",
  "com.linkedin.android",
  "com.twitter.android",
  "com.x.android",
  "com.zhiliaoapp.musically",
  "com.ss.android.ugc.trill",
  "com.snapchat.android",
  "com.google.android.gm",
  "com.microsoft.office.outlook"
];

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

export default function ScreenScrapesPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice] = useState<any>(null);
  const [logs, setLogs] = useState<ScreenScrapedLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSuspicious, setFilterSuspicious] = useState<boolean | 'all'>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // OCR Settings Panel States
  const [showSettings, setShowSettings] = useState(false);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [selectedOcrPackages, setSelectedOcrPackages] = useState<string[]>([]);
  const [searchAppQuery, setSearchAppQuery] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('screen_scraped_logs')
        .select('*')
        .eq('device_id', target.id)
        .order('recorded_at', { ascending: false })
        .limit(500);
      if (error) {
        setErrorMsg(`Gagal memuat teks OCR layar: ${error.message}`);
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

        // Load dynamic OCR settings from device row
        const currentOcr = Array.isArray(dev.ocr_packages) 
          ? (dev.ocr_packages as string[]) 
          : DEFAULT_OCR_PACKAGES;
        setSelectedOcrPackages(currentOcr);

        // Fetch installed apps for the toggle list
        const appsRes = await supabase
          .from('installed_apps')
          .select('id, app_name, app_package')
          .eq('device_id', dev.id)
          .eq('is_uninstalled', false)
          .order('app_name', { ascending: true });
        
        if (appsRes.data) {
          setInstalledApps(appsRes.data);
        }

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
    const channel = supabase.channel(`scrapes-${device.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'screen_scraped_logs', filter: `device_id=eq.${device.id}` }, () => {
        fetchData(device, true);
      }).subscribe();
    const poll = setInterval(() => fetchData(device, true), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [device, fetchData]);

  const handleDelete = async (id: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    setLogs(prev => prev.filter(l => l.id !== id));
    await supabase.from('screen_scraped_logs').delete().eq('id', id);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const toggleExpand = (id: string) => {
    setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleOcrPackage = (pkg: string) => {
    setSelectedOcrPackages(prev => 
      prev.includes(pkg) ? prev.filter(p => p !== pkg) : [...prev, pkg]
    );
  };

  const handleSaveOcrSettings = async () => {
    if (!device) return;
    setSavingSettings(true);
    setSettingsSuccess(false);
    setErrorMsg(null);
    try {
      const { error } = await supabase
        .from('devices')
        .update({ ocr_packages: selectedOcrPackages })
        .eq('id', device.id);

      if (error) {
        console.error("Failed to update ocr_packages:", error);
        setErrorMsg(
          `Gagal menyimpan: ${error.message}. Pastikan kolom 'ocr_packages' sudah ditambahkan di database Supabase.`
        );
      } else {
        setSettingsSuccess(true);
        setTimeout(() => setSettingsSuccess(false), 3000);
        // Refresh local device status representation
        setDevice((prev: any) => ({ ...prev, ocr_packages: selectedOcrPackages }));
      }
    } catch (err: any) {
      setErrorMsg(`Error saving settings: ${err?.message ?? err}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.scraped_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.app_package.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSuspicious = filterSuspicious === 'all' || log.is_suspicious === filterSuspicious;
    return matchesSearch && matchesSuspicious;
  });

  const filteredInstalledApps = installedApps.filter(app => 
    app.app_name.toLowerCase().includes(searchAppQuery.toLowerCase()) ||
    app.app_package.toLowerCase().includes(searchAppQuery.toLowerCase())
  );

  const totalLogs = logs.length;
  const suspiciousCount = logs.filter(l => l.is_suspicious).length;

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat log teks layar...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Aktivitas Layar</h1>
          <p className="text-textSecondary mt-1.5">Hubungkan perangkat anak untuk mulai memantau.</p>
        </div>
      </div>
    );
  }

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('screen_scraped_logs').delete().eq('device_id', device.id);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in relative">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Aktivitas Layar</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Menampilkan hasil ekstraksi teks dari layar HP anak pada aplikasi yang dipantau (OCR).
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-textSecondary/70 hidden sm:inline font-mono">
              Update: {lastUpdated.toLocaleTimeString('id-ID')}
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-4 py-2 bg-cardBg border border-borderDark rounded-xl hover:bg-darkBg transition-colors text-sm font-semibold"
          >
            <Settings size={16} />
            Pengaturan Aplikasi OCR
          </button>
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Scrape'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-sm shrink-0">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 font-semibold">Tindakan Diperlukan</p>
            <p className="text-red-300/80 text-xs mt-1 leading-relaxed">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 shrink-0">
        <div className="glass-card rounded-xl p-4 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Total Ekstraksi</span>
          <span className="text-2xl font-bold mt-1 text-violetLight">{totalLogs}</span>
        </div>
        <div className="glass-card rounded-xl p-4 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Layar Mencurigakan</span>
          <span className="text-2xl font-bold mt-1 text-accentRed">{suspiciousCount}</span>
        </div>
        <div className="glass-card rounded-xl p-4 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Aplikasi Dipantau</span>
          <span className="text-2xl font-bold mt-1 text-accentGreen">{selectedOcrPackages.length} Aplikasi</span>
        </div>
      </div>

      {/* Settings Modal/Panel */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cardBg border border-borderDark rounded-2xl w-full max-w-xl flex flex-col max-h-[85vh] shadow-2xl animate-scale-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-borderDark/60 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg">Aplikasi Terpantau OCR</h3>
                <p className="text-xs text-textSecondary mt-0.5">Pilih aplikasi mana saja yang konten layarnya ingin dipindai (OCR).</p>
              </div>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-1.5 hover:bg-darkBg/60 border border-transparent hover:border-borderDark rounded-lg transition-colors text-textSecondary hover:text-textPrimary"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Search */}
            <div className="p-4 border-b border-borderDark/30 bg-darkBg/20">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Cari aplikasi..."
                  value={searchAppQuery}
                  onChange={e => setSearchAppQuery(e.target.value)}
                  className="w-full bg-darkBg border border-borderDark rounded-xl pl-9 pr-4 py-2 text-xs text-textPrimary focus:outline-none focus:border-accentViolet"
                />
                <Search className="absolute left-3 top-2.5 text-textSecondary" size={14} />
              </div>
            </div>

            {/* Modal App List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 divide-y divide-borderDark/10">
              {filteredInstalledApps.length === 0 ? (
                <div className="text-center py-12 text-textSecondary">
                  <Smartphone size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Tidak ada aplikasi terinstal ditemukan.</p>
                </div>
              ) : (
                filteredInstalledApps.map(app => {
                  const isChecked = selectedOcrPackages.includes(app.app_package);
                  return (
                    <div 
                      key={app.id} 
                      onClick={() => handleToggleOcrPackage(app.app_package)}
                      className="flex items-center justify-between p-3.5 hover:bg-darkBg/40 rounded-xl cursor-pointer transition-colors group"
                    >
                      <div className="min-w-0 pr-4">
                        <p className="text-xs font-bold text-textPrimary">{app.app_name}</p>
                        <p className="text-[10px] text-textSecondary/60 font-mono truncate mt-0.5">{app.app_package}</p>
                      </div>
                      
                      {/* Premium iOS-style Toggle Switch */}
                      <button
                        type="button"
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors focus:outline-none ${
                          isChecked ? 'bg-accentGreen' : 'bg-darkBg border border-borderDark'
                        }`}
                      >
                        <div 
                          className={`w-3.8 h-3.8 rounded-full bg-white transition-transform ${
                            isChecked ? 'translate-x-4' : 'translate-x-0'
                          }`} 
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-borderDark/60 bg-darkBg/40 flex items-center justify-between">
              <span className="text-[10px] text-textSecondary font-semibold">
                {selectedOcrPackages.length} Aplikasi Terpilih
              </span>
              
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 border border-borderDark rounded-xl hover:bg-darkBg text-xs font-semibold text-textSecondary transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveOcrSettings}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accentViolet hover:bg-accentViolet/90 text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  {savingSettings ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : settingsSuccess ? (
                    <Check size={13} />
                  ) : null}
                  {savingSettings ? 'Menyimpan...' : settingsSuccess ? 'Berhasil Disimpan!' : 'Simpan Setelan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between bg-cardBg/20 p-3 rounded-2xl border border-borderDark/40">
        <div className="relative w-80">
          <input
            type="text"
            placeholder="Cari teks di layar..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-darkBg border border-borderDark rounded-xl pl-9 pr-3 py-2 text-xs text-textPrimary focus:outline-none focus:border-accentViolet"
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
            Semua Layar
          </button>
          <button
            onClick={() => setFilterSuspicious(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              filterSuspicious === true
                ? 'bg-accentRed/15 text-accentRed border-accentRed/40'
                : 'glass-card text-textSecondary hover:text-textPrimary'
            }`}
          >
            Mencurigakan
          </button>
        </div>
      </div>

      {/* Timeline List */}
      <div className="space-y-4">
        {filteredLogs.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center text-textSecondary">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm italic">Belum ada data ekstraksi layar yang terkirim</p>
          </div>
        ) : (
          filteredLogs.map(log => {
            const isExpanded = expandedLogs[log.id] || false;
            return (
              <div
                key={log.id}
                className={`glass-card rounded-xl p-4 border transition-all flex flex-col gap-3 ${
                  log.is_suspicious 
                    ? 'border-accentRed/30 bg-accentRed/5' 
                    : 'border-borderDark/40'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      log.is_suspicious 
                        ? 'bg-accentRed/15 text-accentRed border-accentRed/20' 
                        : 'bg-accentViolet/15 text-accentViolet border-accentViolet/20'
                    }`}>
                      {log.is_suspicious ? <ShieldAlert size={18} /> : <FileText size={18} />}
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
                      <p className="text-[10px] text-textSecondary/60 mt-1">
                        {new Date(log.recorded_at).toLocaleString('id-ID')} · {timeAgo(log.recorded_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {log.is_suspicious && (
                      <span className="text-[10px] font-black text-accentRed bg-accentRed/10 border border-accentRed/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle size={11} /> MENCURIGAKAN
                      </span>
                    )}
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="px-3 py-1 bg-cardBg border border-borderDark hover:border-textSecondary rounded-lg text-xs text-textSecondary hover:text-textPrimary transition-colors"
                    >
                      {isExpanded ? 'Sembunyikan' : 'Buka Konten'}
                    </button>
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

                {isExpanded && (
                  <div className="bg-darkBg/60 border border-borderDark/30 px-4 py-3.5 rounded-xl text-xs font-mono leading-relaxed text-textSecondary max-h-[300px] overflow-y-auto break-words whitespace-pre-wrap animate-slide-down">
                    {log.scraped_text}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
