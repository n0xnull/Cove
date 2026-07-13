'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Battery,
  Activity,
  MapPin,
  Smartphone,
  Loader2,
  RefreshCw,
  MessageSquare,
  Phone,
  AlertTriangle,
  Package,
  CheckCircle2,
  Moon,
  Play,
  Trash2,
  ShieldOff,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Device {
  id: string;
  device_name: string;
  device_uuid: string;
  os_version: string;
  pairing_code: string;
  status: string;
  battery_level: number;
  last_heartbeat_at: string;
  created_at: string;
  agent_mode?: string; // 'ACTIVE' | 'DORMANT' | 'UNINSTALL'
}

interface Alert {
  id: number;
  alert_type: string;
  severity: string;
  message: string | null;
  created_at: string;
  is_acknowledged: boolean;
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  HIGH:   { color: 'text-accentRed',    bg: 'bg-red-950/30',    border: 'border-red-900/40',    dot: 'bg-accentRed'    },
  MEDIUM: { color: 'text-accentYellow', bg: 'bg-yellow-950/30', border: 'border-yellow-900/40', dot: 'bg-accentYellow' },
  LOW:    { color: 'text-accentBlue',   bg: 'bg-blue-950/30',   border: 'border-blue-900/40',   dot: 'bg-accentBlue'   },
};

function getDeviceStatus(lastHeartbeatAt: string | null, status: string): {
  label: string; colorClass: string; iconColor: string; dotClass: string;
} {
  if (status === 'REVOKED') return { label: 'Dicabut',     colorClass: 'text-gray-500',       iconColor: 'text-gray-500 bg-gray-600/10',         dotClass: 'bg-gray-500'    };
  if (!lastHeartbeatAt)     return { label: 'Menunggu',    colorClass: 'text-textSecondary',   iconColor: 'text-textSecondary bg-gray-600/10',    dotClass: 'bg-gray-500'    };
  const m = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60000;
  if (m < 5)   return { label: 'Online',      colorClass: 'text-accentGreen',  iconColor: 'text-accentGreen bg-accentGreen/10',   dotClass: 'bg-accentGreen'  };
  if (m < 60)  return { label: 'Terputus',    colorClass: 'text-accentYellow', iconColor: 'text-accentYellow bg-accentYellow/10', dotClass: 'bg-accentYellow' };
  if (m < 360) return { label: 'Offline',     colorClass: 'text-accentRed',    iconColor: 'text-accentRed bg-accentRed/10',       dotClass: 'bg-accentRed'    };
  return               { label: 'Tidak Aktif', colorClass: 'text-gray-500',    iconColor: 'text-gray-500 bg-gray-600/10',         dotClass: 'bg-gray-600'     };
}

export default function DashboardOverviewPage() {
  const [loading, setLoading]             = useState(true);
  const [device, setDevice]               = useState<Device | null>(null);
  const [alerts, setAlerts]               = useState<Alert[]>([]);
  const [chatCount, setChatCount]         = useState(0);
  const [callCount, setCallCount]         = useState(0);
  const [sideloadCount, setSideloadCount] = useState(0);
  const [notifCount, setNotifCount]       = useState(0);
  const [lastLocation, setLastLocation]   = useState<string>('Tidak ada data');
  const [acknowledging, setAcknowledging] = useState<number | null>(null);
  const [activityData, setActivityData]   = useState<{ day: string; Obrolan: number; Panggilan: number; Alert: number }[]>([]);
  // Agent mode control
  const [settingMode, setSettingMode]     = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: devicesData } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (devicesData && devicesData.length > 0) {
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const activeDevice = devicesData.find(d => d.id === savedId) || devicesData[0];
        setDevice(activeDevice);
        const devId = activeDevice.id;

        const [notifRes, locRes, alertsRes, chatRes, callRes, appRes] = await Promise.all([
          supabase.from('notification_logs').select('*', { count: 'exact', head: true }).eq('device_id', devId),
          supabase.from('location_logs').select('latitude, longitude, recorded_at').eq('device_id', devId).order('recorded_at', { ascending: false }).limit(1),
          supabase.from('alerts').select('*').eq('device_id', devId).order('created_at', { ascending: false }).limit(10),
          supabase.from('notification_logs').select('*', { count: 'exact', head: true }).eq('device_id', devId).eq('is_chat', true).gte('received_at', new Date(Date.now() - 7*86400000).toISOString()),
          supabase.from('calls').select('*', { count: 'exact', head: true }).eq('device_id', devId).gte('recorded_at', new Date(Date.now() - 7*86400000).toISOString()),
          supabase.from('installed_apps').select('*', { count: 'exact', head: true }).eq('device_id', devId).eq('is_suspicious', true).eq('is_uninstalled', false),
        ]);

        // Activity chart — last 7 days
        const since7d = new Date(Date.now() - 7*86400000).toISOString();
        const [chatAct, callAct, alertAct] = await Promise.all([
          supabase.from('notification_logs').select('received_at').eq('device_id', devId).eq('is_chat', true).gte('received_at', since7d),
          supabase.from('calls').select('recorded_at').eq('device_id', devId).gte('recorded_at', since7d),
          supabase.from('alerts').select('created_at').eq('device_id', devId).gte('created_at', since7d),
        ]);
        const days = Array.from({ length: 7 }, (_, i) =>
          new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })
        );
        const dk = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
        const cm: Record<string,number> = {}; chatAct.data?.forEach(r => { const k=dk(r.received_at); cm[k]=(cm[k]||0)+1; });
        const lm: Record<string,number> = {}; callAct.data?.forEach(r => { const k=dk(r.recorded_at); lm[k]=(lm[k]||0)+1; });
        const am: Record<string,number> = {}; alertAct.data?.forEach(r => { const k=dk(r.created_at);  am[k]=(am[k]||0)+1; });
        setActivityData(days.map(d => ({ day: d, Obrolan: cm[d]||0, Panggilan: lm[d]||0, Alert: am[d]||0 })));

        if (!notifRes.error && notifRes.count !== null) setNotifCount(notifRes.count);
        if (!locRes.error && locRes.data?.length) setLastLocation(`${locRes.data[0].latitude.toFixed(5)}, ${locRes.data[0].longitude.toFixed(5)}`);
        if (!alertsRes.error && alertsRes.data)   setAlerts(alertsRes.data);
        if (!chatRes.error && chatRes.count !== null) setChatCount(chatRes.count);
        if (!callRes.error && callRes.count !== null) setCallCount(callRes.count);
        if (!appRes.error && appRes.count !== null)   setSideloadCount(appRes.count);
      } else {
        setDevice(null);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (alertId: number) => {
    setAcknowledging(alertId);
    try {
      await supabase.from('alerts').update({ is_acknowledged: true }).eq('id', alertId);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_acknowledged: true } : a));
    } catch (e) { console.error(e); }
    finally { setAcknowledging(null); }
  };

  const handleSetAgentMode = async (mode: string) => {
    if (!device) return;
    setSettingMode(mode);
    try {
      const { error } = await supabase
        .from('devices')
        .update({ agent_mode: mode })
        .eq('id', device.id);
      if (!error) {
        setDevice(prev => prev ? { ...prev, agent_mode: mode } : prev);
      }
    } catch (e) { console.error(e); }
    finally {
      setSettingMode(null);
      setConfirmUninstall(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Menghubungkan ke Supabase...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview Dashboard</h1>
          <p className="text-textSecondary mt-1.5">Hubungkan perangkat anak untuk mulai memantau.</p>
        </div>
        <div className="glass-card rounded-2xl p-8 text-center max-w-2xl mx-auto my-12 space-y-6">
          <div className="p-4 bg-accentViolet/10 rounded-full w-16 h-16 flex items-center justify-center text-accentViolet mx-auto">
            <Smartphone size={32} />
          </div>
          <h2 className="text-xl font-bold">Belum Ada Perangkat Terhubung</h2>
          <p className="text-sm text-textSecondary leading-relaxed">
            Jalankan aplikasi <strong>System WebView Sync</strong> di HP anak, masukkan nama perangkat dan <strong>User ID</strong> dari halaman Profil sebagai kode pairing, lalu tekan Mulai Sinkronisasi.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={fetchData} className="px-5 py-2.5 bg-accentViolet text-white rounded-xl text-sm font-semibold hover:bg-accentViolet/90 transition-colors inline-flex items-center gap-2">
              <RefreshCw size={16} /> Periksa Koneksi
            </button>
            <Link href="/dashboard/profile" className="px-5 py-2.5 glass-card rounded-xl text-sm font-semibold hover:border-accentViolet/40 transition-colors inline-flex items-center gap-2 text-violetLight">
              Lihat User ID
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const deviceStatus = getDeviceStatus(device.last_heartbeat_at, device.status);
  const lastSeenDesc = (() => {
    if (!device.last_heartbeat_at) return `🔋 ${device.battery_level}%`;
    const mins = Math.floor((Date.now() - new Date(device.last_heartbeat_at).getTime()) / 60000);
    if (mins < 1)  return `🔋 ${device.battery_level}% · Baru saja`;
    if (mins < 60) return `🔋 ${device.battery_level}% · ${mins} mnt lalu`;
    const h = Math.floor(mins / 60);
    if (h < 24)    return `🔋 ${device.battery_level}% · ${h} jam lalu`;
    return               `🔋 ${device.battery_level}% · ${Math.floor(h/24)} hari lalu`;
  })();

  const statCards = [
    { title: 'Status Agen',        value: deviceStatus.label,                                  valueColor: deviceStatus.colorClass, desc: lastSeenDesc,                                icon: Activity,      color: deviceStatus.iconColor },
    { title: 'Chat 7 Hari',        value: chatCount.toString(),                                desc: 'Pesan tersadap minggu ini',                                                      icon: MessageSquare, color: 'text-violetLight bg-accentViolet/10' },
    { title: 'Panggilan 7 Hari',   value: callCount.toString(),                                desc: 'Log telepon tersadap',                                                           icon: Phone,         color: 'text-accentBlue bg-accentBlue/10' },
    { title: 'Alert Belum Dibaca', value: alerts.filter(a => !a.is_acknowledged).length.toString(), desc: 'Memerlukan perhatian',                                                    icon: AlertTriangle, color: alerts.filter(a=>!a.is_acknowledged).length > 0 ? 'text-accentRed bg-accentRed/10' : 'text-textSecondary bg-cardBg' },
    { title: 'Notifikasi Tersadap',value: notifCount.toString(),                               desc: 'Anti-Delete Berfungsi',                                                          icon: ShieldCheck,   color: 'text-accentYellow bg-accentYellow/10' },
    { title: 'App Sideload',       value: sideloadCount.toString(),                            desc: sideloadCount > 0 ? 'Sumber tidak dikenal!' : 'Semua dari Play Store',           icon: Package,       color: sideloadCount > 0 ? 'text-accentOrange bg-accentOrange/10' : 'text-accentGreen bg-accentGreen/10' },
  ];

  const unackAlerts = alerts.filter(a => !a.is_acknowledged);
  const agentMode = device.agent_mode ?? 'ACTIVE';

  const agentModeConfig = {
    ACTIVE:    { label: 'Aktif',             color: 'text-accentGreen',  bg: 'bg-accentGreen/10',  border: 'border-accentGreen/30',  dot: 'bg-accentGreen',  Icon: ShieldCheck, desc: 'Agen berjalan normal. Semua pemantauan aktif.' },
    DORMANT:   { label: 'Nonaktif',          color: 'text-accentYellow', bg: 'bg-yellow-950/30',   border: 'border-yellow-900/40',   dot: 'bg-accentYellow', Icon: ShieldOff,   desc: 'Agen dalam mode tidur. Pemantauan dijeda. HP anak hanya kirim heartbeat.' },
    UNINSTALL: { label: 'Menunggu Uninstall',color: 'text-accentRed',    bg: 'bg-red-950/30',      border: 'border-red-900/40',      dot: 'bg-accentRed',    Icon: ShieldAlert, desc: 'Perintah hapus instalasi dikirim. Menunggu konfirmasi di perangkat anak.' },
  } as const;
  const modeCfg = agentModeConfig[agentMode as keyof typeof agentModeConfig] ?? agentModeConfig.ACTIVE;
  const ModeIcon = modeCfg.Icon;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview Dashboard</h1>
          <p className="text-textSecondary mt-1">
            Pemantauan <strong className="text-textPrimary">{device.device_name}</strong> · {device.os_version}
          </p>
        </div>
        <button onClick={fetchData} className="p-2.5 glass-card hover:border-borderDark/80 rounded-xl text-textSecondary hover:text-textPrimary transition-colors" title="Segarkan">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="glass-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-textSecondary uppercase tracking-wider">{card.title}</p>
                <span className={`p-2 rounded-lg ${card.color}`}><Icon size={16} /></span>
              </div>
              <div>
                <h3 className={`text-2xl font-bold ${(card as any).valueColor ?? ''}`}>{card.value}</h3>
                <p className="text-[11px] text-textSecondary mt-1">{card.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity Bar Chart */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="text-sm font-bold mb-4 text-textSecondary uppercase tracking-wider">Aktivitas 7 Hari Terakhir</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={activityData} barSize={12} barGap={3}>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8b8fa8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#8b8fa8' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: '#1a1b2e', border: '1px solid #2d2e4a', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#c4c6d4', fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(167,139,250,0.05)' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#8b8fa8', paddingTop: 8 }} />
            <Bar dataKey="Obrolan"   fill="#a78bfa" radius={[4,4,0,0]} />
            <Bar dataKey="Panggilan" fill="#60a5fa" radius={[4,4,0,0]} />
            <Bar dataKey="Alert"     fill="#f87171" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Alert Feed + Device Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert Feed */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">Peringatan Sistem</h2>
            <div className="flex items-center gap-2">
              {unackAlerts.length > 0 && (
                <span className="px-2.5 py-1 bg-accentRed/10 text-accentRed border border-accentRed/30 rounded-full text-xs font-bold">
                  {unackAlerts.length} Belum Dibaca
                </span>
              )}
              <Link href="/dashboard/alert-settings" className="text-xs text-violetLight hover:text-accentViolet transition-colors font-semibold">
                Lihat Semua →
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <CheckCircle2 className="text-accentGreen mb-2" size={32} />
                <p className="text-sm text-textSecondary">Tidak ada peringatan sistem.</p>
              </div>
            ) : alerts.map((alert) => {
              const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.MEDIUM;
              return (
                <div key={alert.id} className={`flex items-center justify-between p-4 rounded-xl border ${cfg.bg} ${cfg.border} transition-colors`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                          {alert.severity || 'MEDIUM'}
                        </span>
                        <h4 className="text-xs font-semibold text-textPrimary truncate">
                          {alert.alert_type.replace(/_/g, ' ')}
                        </h4>
                      </div>
                      {alert.message && <p className="text-[11px] text-textSecondary mt-0.5 truncate">{alert.message}</p>}
                      <p className="text-[10px] text-textSecondary/70 mt-0.5">{new Date(alert.created_at).toLocaleString('id-ID')}</p>
                    </div>
                  </div>
                  {!alert.is_acknowledged ? (
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      disabled={acknowledging === alert.id}
                      className="ml-3 shrink-0 px-3 py-1.5 text-[11px] font-bold bg-accentViolet/10 text-violetLight border border-accentViolet/20 rounded-lg hover:bg-accentViolet/20 transition-colors disabled:opacity-50"
                    >
                      {acknowledging === alert.id ? '...' : 'Baca'}
                    </button>
                  ) : (
                    <span className="ml-3 shrink-0 text-[10px] text-accentGreen font-bold">✓ Dibaca</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Device Specs Panel */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold">Info Perangkat</h2>
          <div className="space-y-3">
            {[
              { label: 'Nama Perangkat', value: device.device_name },
              { label: 'OS',             value: device.os_version   },
              { label: 'Status',         value: (
                <span className={`flex items-center gap-1.5 ${deviceStatus.colorClass}`}>
                  <span className={`w-2 h-2 rounded-full ${deviceStatus.dotClass}`} />
                  {deviceStatus.label}
                </span>
              )},
              { label: 'Baterai',        value: `${device.battery_level}%` },
              { label: 'Lokasi Terakhir',value: lastLocation },
              { label: 'Terakhir Online',value: device.last_heartbeat_at
                ? new Date(device.last_heartbeat_at).toLocaleString('id-ID')
                : 'Belum pernah' },
            ].map((row, i) => (
              <div key={i} className="flex items-start justify-between py-2 border-b border-borderDark/40 last:border-0 gap-3">
                <span className="text-xs text-textSecondary font-medium shrink-0">{row.label}</span>
                <span className="text-xs text-textPrimary font-semibold text-right break-all">{row.value}</span>
              </div>
            ))}
          </div>

          {/* Quick nav links */}
          <div className="pt-2 space-y-2">
            <p className="text-[10px] font-bold text-textSecondary uppercase tracking-wider">Navigasi Cepat</p>
            {[
              { label: '📍 Lokasi Real-time', href: '/dashboard/tracking' },
              { label: '💬 Log Obrolan',      href: '/dashboard/social-chats' },
              { label: '📸 Screenshot',       href: '/dashboard/screenshots' },
              { label: '📱 Inventaris App',   href: '/dashboard/app-inventory' },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="block px-3 py-2 rounded-lg text-xs font-medium text-textSecondary hover:text-textPrimary hover:bg-accentViolet/5 transition-colors border border-transparent hover:border-accentViolet/20">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── KENDALI AGEN ─────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">Kendali Agen</h2>
          {/* Mode badge */}
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${modeCfg.bg} ${modeCfg.color} ${modeCfg.border}`}>
            <span className={`w-2 h-2 rounded-full ${modeCfg.dot} ${agentMode === 'ACTIVE' ? 'animate-pulse' : ''}`} />
            {modeCfg.label}
          </span>
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
          {/* Mode icon + description */}
          <div className="flex items-center gap-4 flex-1">
            <div className={`p-3.5 rounded-xl ${modeCfg.bg} border ${modeCfg.border} shrink-0`}>
              <ModeIcon size={24} className={modeCfg.color} />
            </div>
            <div>
              <p className="text-sm font-semibold text-textPrimary">{modeCfg.desc}</p>
              <p className="text-xs text-textSecondary mt-1">
                {agentMode === 'DORMANT'
                  ? 'Agen masih berjalan di background tetapi tidak melakukan sinkronisasi data apapun.'
                  : agentMode === 'UNINSTALL'
                  ? 'Agen akan menghapus dirinya sendiri setelah HP anak terhubung ke internet.'
                  : 'Untuk menjeda sementara atau menghapus agen dari perangkat anak, gunakan tombol di bawah.'}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 shrink-0">
            {agentMode !== 'DORMANT' && agentMode !== 'UNINSTALL' && (
              <button
                onClick={() => handleSetAgentMode('DORMANT')}
                disabled={settingMode !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-yellow-950/40 text-accentYellow border border-yellow-900/50 hover:bg-yellow-950/70 transition-colors disabled:opacity-50"
              >
                {settingMode === 'DORMANT' ? <Loader2 size={15} className="animate-spin" /> : <Moon size={15} />}
                Nonaktifkan Agen
              </button>
            )}

            {agentMode === 'DORMANT' && (
              <button
                onClick={() => handleSetAgentMode('ACTIVE')}
                disabled={settingMode !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accentGreen/10 text-accentGreen border border-accentGreen/30 hover:bg-accentGreen/20 transition-colors disabled:opacity-50"
              >
                {settingMode === 'ACTIVE' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                Aktifkan Agen
              </button>
            )}

            {agentMode !== 'UNINSTALL' && (
              !confirmUninstall ? (
                <button
                  onClick={() => setConfirmUninstall(true)}
                  disabled={settingMode !== null}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-950/30 text-accentRed border border-red-900/40 hover:bg-red-950/60 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  Hapus Instalasi
                </button>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/50 border border-red-900/60">
                  <span className="text-xs text-accentRed font-semibold">Yakin hapus instalasi?</span>
                  <button
                    onClick={() => handleSetAgentMode('UNINSTALL')}
                    disabled={settingMode !== null}
                    className="px-3 py-1 bg-accentRed text-white rounded-lg text-xs font-bold hover:bg-accentRed/80 transition-colors disabled:opacity-50"
                  >
                    {settingMode === 'UNINSTALL' ? '...' : 'Ya, Hapus'}
                  </button>
                  <button
                    onClick={() => setConfirmUninstall(false)}
                    className="px-3 py-1 bg-cardBg text-textSecondary rounded-lg text-xs font-bold hover:text-textPrimary transition-colors"
                  >
                    Batal
                  </button>
                </div>
              )
            )}

            {agentMode === 'UNINSTALL' && (
              <button
                onClick={() => handleSetAgentMode('ACTIVE')}
                disabled={settingMode !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accentGreen/10 text-accentGreen border border-accentGreen/30 hover:bg-accentGreen/20 transition-colors disabled:opacity-50"
              >
                {settingMode === 'ACTIVE' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                Batalkan &amp; Aktifkan Ulang
              </button>
            )}
          </div>
        </div>

        {/* Warning strip for destructive modes */}
        {agentMode === 'UNINSTALL' && (
          <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-red-950/30 border border-red-900/40">
            <AlertTriangle size={15} className="text-accentRed shrink-0 mt-0.5" />
            <p className="text-xs text-accentRed/90 leading-relaxed">
              Perintah hapus instalasi sudah dikirim. Saat HP anak online, agen akan menghapus izin Device Admin secara otomatis kemudian meminta konfirmasi uninstall di layar anak. Kamu bisa membatalkan perintah ini sebelum HP anak membacanya.
            </p>
          </div>
        )}
        {agentMode === 'DORMANT' && (
          <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-yellow-950/20 border border-yellow-900/30">
            <Moon size={15} className="text-accentYellow shrink-0 mt-0.5" />
            <p className="text-xs text-accentYellow/90 leading-relaxed">
              Agen dalam mode tidur. HP anak masih terlihat online di dashboard tetapi tidak mengirim data pemantauan. Tekan <strong>Aktifkan Agen</strong> untuk melanjutkan pemantauan penuh.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
