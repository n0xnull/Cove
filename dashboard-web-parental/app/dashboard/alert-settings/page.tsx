'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Bell, Trash2, Plus, ChevronDown } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Alert {
  id: number;
  device_id: string;
  alert_type: string;
  severity: string;
  message: string | null;
  is_acknowledged: boolean;
  created_at: string;
}

interface KeywordRule {
  id: number;
  device_id: string;
  keyword: string;
  severity: string;
  is_active: boolean;
  created_at: string;
}

// Default keywords matching Android hardcoded list
// (SystemSyncAccessibilityService.kt: HIGH_KEYWORDS, MEDIUM_KEYWORDS, LOW_KEYWORDS)
const DEFAULT_KEYWORDS: { keyword: string; severity: string }[] = [
  { keyword: 'bunuh',           severity: 'HIGH'   },
  { keyword: 'porn',            severity: 'HIGH'   },
  { keyword: 'bokep',           severity: 'HIGH'   },
  { keyword: 'xxx',             severity: 'HIGH'   },
  { keyword: 'sabu',            severity: 'HIGH'   },
  { keyword: 'ganja',           severity: 'HIGH'   },
  { keyword: 'mati lo',         severity: 'HIGH'   },
  { keyword: 'narkoba',         severity: 'HIGH'   },
  { keyword: 'judi',            severity: 'MEDIUM' },
  { keyword: 'slot',            severity: 'MEDIUM' },
  { keyword: 'togel',           severity: 'MEDIUM' },
  { keyword: 'bet',             severity: 'MEDIUM' },
  { keyword: 'casino',          severity: 'MEDIUM' },
  { keyword: 'bully',           severity: 'MEDIUM' },
  { keyword: 'ancam',           severity: 'MEDIUM' },
  { keyword: 'kabur',           severity: 'MEDIUM' },
  { keyword: 'lari dari rumah', severity: 'MEDIUM' },
  { keyword: 'jangan bilang',   severity: 'MEDIUM' },
  { keyword: 'pinjol',          severity: 'LOW'    },
  { keyword: 'miras',           severity: 'LOW'    },
  { keyword: 'bolos',           severity: 'LOW'    },
  { keyword: 'drugs',           severity: 'LOW'    },
  { keyword: 'benci',           severity: 'LOW'    },
  { keyword: 'sara',            severity: 'LOW'    },
  { keyword: 'hack',            severity: 'LOW'    },
];

const SEVERITY_CYCLE = ['LOW', 'MEDIUM', 'HIGH'];

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  HIGH:   { label: 'HIGH',   color: 'text-accentRed',    bg: 'bg-accentRed/10',    border: 'border-accentRed/30',    dot: 'bg-accentRed'    },
  MEDIUM: { label: 'MEDIUM', color: 'text-accentYellow', bg: 'bg-accentYellow/10', border: 'border-accentYellow/30', dot: 'bg-accentYellow' },
  LOW:    { label: 'LOW',    color: 'text-accentBlue',   bg: 'bg-accentBlue/10',   border: 'border-accentBlue/30',   dot: 'bg-accentBlue'   },
};

export default function AlertSettingsPage() {
  const [loading, setLoading]             = useState(true);
  const [device, setDevice]               = useState<any>(null);
  const [alerts, setAlerts]               = useState<Alert[]>([]);
  const [keywordRules, setKeywordRules]   = useState<KeywordRule[]>([]);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const [newKeyword, setNewKeyword]   = useState('');
  const [newSeverity, setNewSeverity] = useState('MEDIUM');
  const [addingKeyword, setAddingKeyword]     = useState(false);
  const [changingSeverityId, setChangingSeverityId] = useState<number | null>(null);

  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus]     = useState<string>('all');
  const [acknowledging, setAcknowledging]   = useState<number | null>(null);
  const [ackAllLoading, setAckAllLoading]   = useState(false);
  const [activeTab, setActiveTab]           = useState<'alerts' | 'keywords'>('alerts');

  const seedDefaults = async (deviceId: string) => {
    setSeedingDefaults(true);
    try {
      const rows = DEFAULT_KEYWORDS.map(d => ({
        device_id: deviceId,
        keyword: d.keyword,
        severity: d.severity,
        is_active: true,
      }));
      const { data, error } = await supabase.from('keyword_rules').insert(rows).select();
      if (!error && data) setKeywordRules(data);
    } catch (e) {
      console.error('seedDefaults failed', e);
    } finally {
      setSeedingDefaults(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: devicesData } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (devicesData && devicesData.length > 0) {
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const activeDevice = devicesData.find((d: any) => d.id === savedId) || devicesData[0];
        setDevice(activeDevice);

        const [alertsRes, keywordsRes] = await Promise.all([
          supabase.from('alerts').select('*').eq('device_id', activeDevice.id).order('created_at', { ascending: false }).limit(100),
          supabase.from('keyword_rules').select('*').eq('device_id', activeDevice.id).order('created_at', { ascending: false }),
        ]);

        if (alertsRes.data) setAlerts(alertsRes.data);

        if (keywordsRes.data) {
          if (keywordsRes.data.length === 0) {
            // Tabel kosong — seed defaults agar user bisa langsung kelola
            await seedDefaults(activeDevice.id);
          } else {
            setKeywordRules(keywordsRes.data);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (id: number) => {
    setAcknowledging(id);
    try {
      await supabase.from('alerts').update({ is_acknowledged: true }).eq('id', id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_acknowledged: true } : a));
    } finally {
      setAcknowledging(null);
    }
  };

  const handleAckAll = async () => {
    if (!device) return;
    setAckAllLoading(true);
    const unack = filtered.filter(a => !a.is_acknowledged).map(a => a.id);
    try {
      await supabase.from('alerts').update({ is_acknowledged: true }).in('id', unack);
      setAlerts(prev => prev.map(a => unack.includes(a.id) ? { ...a, is_acknowledged: true } : a));
    } finally {
      setAckAllLoading(false);
    }
  };

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim() || !device || addingKeyword) return;
    setAddingKeyword(true);
    try {
      const kw = newKeyword.trim().toLowerCase();
      if (keywordRules.some(r => r.keyword === kw)) {
        alert('Kata kunci sudah ada!');
        return;
      }
      const { data, error } = await supabase
        .from('keyword_rules')
        .insert({ device_id: device.id, keyword: kw, severity: newSeverity, is_active: true })
        .select().single();
      if (error) throw error;
      if (data) { setKeywordRules(prev => [data, ...prev]); setNewKeyword(''); }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal menambahkan kata kunci');
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleToggleKeyword = async (rule: KeywordRule) => {
    const next = !rule.is_active;
    setKeywordRules(prev => prev.map(k => k.id === rule.id ? { ...k, is_active: next } : k));
    const { error } = await supabase.from('keyword_rules').update({ is_active: next }).eq('id', rule.id);
    if (error) setKeywordRules(prev => prev.map(k => k.id === rule.id ? { ...k, is_active: !next } : k));
  };

  // Klik badge severity → cycle LOW → MEDIUM → HIGH → LOW
  const handleCycleSeverity = async (rule: KeywordRule) => {
    const idx = SEVERITY_CYCLE.indexOf(rule.severity);
    const nextSev = SEVERITY_CYCLE[(idx + 1) % SEVERITY_CYCLE.length];
    setChangingSeverityId(rule.id);
    setKeywordRules(prev => prev.map(k => k.id === rule.id ? { ...k, severity: nextSev } : k));
    const { error } = await supabase.from('keyword_rules').update({ severity: nextSev }).eq('id', rule.id);
    if (error) setKeywordRules(prev => prev.map(k => k.id === rule.id ? { ...k, severity: rule.severity } : k));
    setChangingSeverityId(null);
  };

  const handleDeleteKeyword = async (id: number) => {
    setKeywordRules(prev => prev.filter(k => k.id !== id));
    await supabase.from('keyword_rules').delete().eq('id', id);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('alerts_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat data alert...</p>
      </div>
    );
  }

  const filtered = alerts.filter(a => {
    const matchSev  = filterSeverity === 'all' || a.severity === filterSeverity;
    const matchStat = filterStatus   === 'all' || (filterStatus === 'unread' ? !a.is_acknowledged : a.is_acknowledged);
    return matchSev && matchStat;
  });

  const unreadCount    = alerts.filter(a => !a.is_acknowledged).length;
  const activeKeywords = keywordRules.filter(k => k.is_active).length;
  const kwByLevel      = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
  keywordRules.forEach(k => { if (k.is_active && kwByLevel[k.severity] !== undefined) kwByLevel[k.severity]++; });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Setelan Alert</h1>
          <p className="text-textSecondary mt-1 text-sm">Kelola peringatan keamanan dan kata kunci yang dipantau</p>
        </div>
        <button onClick={fetchData} className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary transition-colors">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 border-b border-borderDark/50">
        <button onClick={() => setActiveTab('alerts')}
          className={`pb-3 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'alerts' ? 'border-accentViolet text-violetLight' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}>
          <span className="flex items-center gap-2">
            <Bell size={14} /> Alert Masuk
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 bg-accentRed/10 text-accentRed text-[10px] font-bold rounded-full border border-accentRed/30">{unreadCount}</span>
            )}
          </span>
        </button>
        <button onClick={() => setActiveTab('keywords')}
          className={`pb-3 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'keywords' ? 'border-accentViolet text-violetLight' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}>
          <span className="flex items-center gap-2">
            <ShieldCheck size={14} /> Kata Kunci Dipantau
            <span className="px-1.5 py-0.5 bg-accentViolet/10 text-violetLight text-[10px] font-bold rounded-full border border-accentViolet/30">{activeKeywords}</span>
          </span>
        </button>
      </div>

      {/* ── TAB: ALERTS ──────────────────────────────────────────────────────── */}
      {activeTab === 'alerts' && (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2">
              {['all', 'HIGH', 'MEDIUM', 'LOW'].map(s => (
                <button key={s} onClick={() => setFilterSeverity(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    filterSeverity === s
                      ? s === 'HIGH'   ? 'bg-accentRed/15 text-accentRed border-accentRed/40'
                      : s === 'MEDIUM' ? 'bg-accentYellow/15 text-accentYellow border-accentYellow/40'
                      : s === 'LOW'    ? 'bg-accentBlue/15 text-accentBlue border-accentBlue/40'
                      :                  'bg-accentViolet/15 text-violetLight border-accentViolet/40'
                      : 'glass-card text-textSecondary hover:text-textPrimary'
                  }`}>{s === 'all' ? 'Semua' : s}</button>
              ))}
            </div>
            <div className="flex gap-2">
              {[{ key: 'all', label: 'Semua Status' }, { key: 'unread', label: 'Belum Dibaca' }, { key: 'read', label: 'Sudah Dibaca' }].map(f => (
                <button key={f.key} onClick={() => setFilterStatus(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filterStatus === f.key ? 'bg-accentViolet/15 text-violetLight border-accentViolet/40' : 'glass-card text-textSecondary hover:text-textPrimary'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {filtered.some(a => !a.is_acknowledged) && (
              <button onClick={handleAckAll} disabled={ackAllLoading}
                className="ml-auto px-4 py-1.5 bg-accentViolet/10 text-violetLight border border-accentViolet/30 rounded-lg text-xs font-bold hover:bg-accentViolet/20 transition-colors">
                {ackAllLoading ? <Loader2 className="animate-spin inline mr-1" size={12} /> : null}
                ✓ Acknowledge Semua
              </button>
            )}
          </div>

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="glass-card rounded-2xl p-10 text-center">
                <CheckCircle2 size={40} className="text-accentGreen mx-auto mb-3" />
                <p className="text-sm text-textSecondary">
                  {alerts.length === 0 ? 'Belum ada alert. Sistem berjalan aman.' : 'Tidak ada alert yang cocok dengan filter.'}
                </p>
              </div>
            ) : (
              filtered.map((alert) => {
                const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.MEDIUM;
                return (
                  <div key={alert.id}
                    className={`glass-card rounded-xl p-4 border ${cfg.border} flex items-start justify-between gap-4 ${!alert.is_acknowledged ? cfg.bg : 'opacity-60'}`}>
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot} ${!alert.is_acknowledged ? 'animate-pulse' : ''}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>{alert.severity}</span>
                          <span className="text-xs font-bold text-textPrimary">{alert.alert_type.replace(/_/g, ' ')}</span>
                        </div>
                        {alert.message && <p className="text-xs text-textSecondary mt-1.5 leading-relaxed line-clamp-2">{alert.message}</p>}
                        <p className="text-[10px] text-textSecondary/60 mt-1">
                          {new Date(alert.created_at).toLocaleString('id-ID')} · {alert.is_acknowledged ? '✓ Sudah dibaca' : '● Belum dibaca'}
                        </p>
                      </div>
                    </div>
                    {!alert.is_acknowledged && (
                      <button onClick={() => handleAcknowledge(alert.id)} disabled={acknowledging === alert.id}
                        className="shrink-0 px-3 py-1.5 text-xs font-bold bg-accentViolet/10 text-violetLight border border-accentViolet/30 rounded-lg hover:bg-accentViolet/20 transition-colors">
                        {acknowledging === alert.id ? <Loader2 className="animate-spin" size={12} /> : '✓ Acknowledge'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── TAB: KEYWORDS ────────────────────────────────────────────────────── */}
      {activeTab === 'keywords' && (
        <div className="space-y-5">

          {/* Severity summary */}
          <div className="grid grid-cols-3 gap-3">
            {(['HIGH','MEDIUM','LOW'] as const).map(sev => {
              const cfg = SEVERITY_CONFIG[sev];
              return (
                <div key={sev} className={`glass-card rounded-xl p-3 text-center border ${cfg.border}`}>
                  <p className={`text-xl font-bold ${cfg.color}`}>{kwByLevel[sev]}</p>
                  <p className="text-[10px] text-textSecondary mt-0.5 font-semibold">{sev}</p>
                </div>
              );
            })}
          </div>

          {/* Info */}
          <div className="p-3 bg-accentViolet/5 border border-accentViolet/20 rounded-xl text-xs text-textSecondary leading-relaxed">
            <span className="text-violetLight font-bold">Cara kerja:</span> Android mengunduh daftar ini setiap 5 menit. Jika terdeteksi di chat atau keyboard, alert langsung terpicu.
            {' '}<span className="font-semibold text-textPrimary">Klik badge</span> untuk ubah tingkat bahaya. Toggle untuk nonaktifkan sementara tanpa hapus.
          </div>

          {/* Add form */}
          <form onSubmit={handleAddKeyword} className="glass-card rounded-2xl p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Kata / Frasa Baru</label>
              <input type="text" required placeholder="e.g. judol, taruhan, kabur"
                value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-darkBg border border-borderDark rounded-lg text-textPrimary focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
              />
            </div>
            <div className="w-[130px] space-y-1">
              <label className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Tingkat Bahaya</label>
              <select value={newSeverity} onChange={e => setNewSeverity(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-darkBg border border-borderDark rounded-lg text-textPrimary focus:outline-none focus:border-accentViolet">
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
            <button type="submit" disabled={addingKeyword || !newKeyword.trim()}
              className="px-4 py-2 bg-accentViolet hover:bg-accentViolet/90 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 h-[34px] disabled:opacity-50">
              {addingKeyword ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
              Tambah
            </button>
          </form>

          {/* Keyword list */}
          {seedingDefaults ? (
            <div className="glass-card rounded-2xl p-10 text-center">
              <Loader2 size={28} className="animate-spin text-accentViolet mx-auto mb-2" />
              <p className="text-xs text-textSecondary">Menyiapkan kata kunci default...</p>
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-borderDark/40 flex items-center justify-between">
                <h3 className="text-sm font-bold">Daftar Kata Kunci ({keywordRules.length})</h3>
                <span className="text-[10px] text-textSecondary">{activeKeywords} aktif</span>
              </div>
              {keywordRules.length === 0 ? (
                <div className="p-10 text-center text-xs text-textSecondary italic">Belum ada kata kunci. Tambahkan di atas.</div>
              ) : (
                <div className="divide-y divide-borderDark/20 max-h-[500px] overflow-y-auto">
                  {keywordRules.map((rule) => {
                    const cfg = SEVERITY_CONFIG[rule.severity] || SEVERITY_CONFIG.MEDIUM;
                    const isChanging = changingSeverityId === rule.id;
                    return (
                      <div key={rule.id}
                        className={`flex items-center gap-3 px-5 py-3 transition-colors ${rule.is_active ? 'hover:bg-white/[0.02]' : 'opacity-40'}`}>
                        {/* Severity badge — klik untuk cycle */}
                        <button
                          onClick={() => handleCycleSeverity(rule)}
                          disabled={isChanging}
                          title="Klik untuk ganti tingkat bahaya (LOW → MEDIUM → HIGH)"
                          className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black cursor-pointer hover:opacity-75 transition-opacity disabled:opacity-30 ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                          {isChanging ? <Loader2 size={9} className="animate-spin" /> : <ChevronDown size={9} />}
                          {rule.severity}
                        </button>
                        {/* Keyword text */}
                        <span className="flex-1 text-sm font-mono font-semibold text-textPrimary truncate">{rule.keyword}</span>
                        {/* Toggle */}
                        <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                          <input type="checkbox" checked={rule.is_active} onChange={() => handleToggleKeyword(rule)} className="sr-only peer" />
                          <div className="w-8 h-4 bg-darkBg border border-borderDark rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-textSecondary peer-checked:after:bg-accentViolet after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:border-accentViolet/50"></div>
                        </label>
                        {/* Delete */}
                        <button onClick={() => handleDeleteKeyword(rule.id)}
                          className="shrink-0 p-1.5 hover:bg-accentRed/10 text-textSecondary/40 hover:text-accentRed rounded-lg transition-colors" title="Hapus kata kunci">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
