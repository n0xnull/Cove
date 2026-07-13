'use client';

import React, { useEffect, useState } from 'react';
import { User, ShieldCheck, Smartphone, LogOut, Loader2, AlertCircle, Download, Package, Baby } from 'lucide-react';
import { supabase, signOut } from '../../../lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';



export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      // V2: Get real user from Supabase Auth
      const { data: { user: authUser } } = await supabase.auth.getUser();
      setUser(authUser);

      if (authUser) {
        const { count } = await supabase
          .from('devices')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', authUser.id);
        if (count !== null) setDeviceCount(count);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (e) {
      console.error(e);
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => { fetchProfile(); }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat profil...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <AlertCircle size={36} className="text-accentRed" />
        <p className="text-sm">Sesi tidak ditemukan. Silakan login ulang.</p>
        <button onClick={() => router.push('/login')} className="mt-2 px-5 py-2.5 bg-accentViolet text-white rounded-xl text-sm font-bold">
          Login Ulang
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profil Orang Tua</h1>
        <p className="text-textSecondary mt-1">Informasi akun dan manajemen perangkat anak</p>
      </div>

      {/* Profile card */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        {/* Avatar + email */}
        <div className="flex items-center gap-4">
          <div className="p-4 bg-accentViolet/10 rounded-full ring-2 ring-accentViolet/20">
            <User size={32} className="text-violetLight" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-textPrimary">{user.email}</h2>
            <p className="text-xs text-textSecondary mt-0.5">
              Bergabung sejak {new Date(user.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="glass-card rounded-xl p-4 text-center">
            <Smartphone size={20} className="text-violetLight mx-auto mb-2" />
            <p className="text-2xl font-bold">{deviceCount}</p>
            <p className="text-[11px] text-textSecondary">Perangkat Terpasang</p>
          </div>
          <div className="glass-card rounded-xl p-4 text-center">
            <ShieldCheck size={20} className="text-accentGreen mx-auto mb-2" />
            <p className="text-2xl font-bold text-accentGreen">Aktif</p>
            <p className="text-[11px] text-textSecondary">Status Akun</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-textPrimary flex items-center gap-2">
          <Package size={18} className="text-accentBlue" />
          Aksi Cepat
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Daftar Anak */}
          <Link href="/dashboard/children"
            className="flex items-center gap-3 p-4 glass-card rounded-xl border border-accentViolet/20 hover:border-accentViolet/40 hover:bg-accentViolet/5 transition-all group">
            <div className="p-2.5 bg-accentViolet/10 rounded-xl group-hover:bg-accentViolet/20 transition-colors">
              <Baby size={18} className="text-violetLight" />
            </div>
            <div>
              <p className="text-sm font-bold text-textPrimary">Daftar Anak</p>
              <p className="text-[11px] text-textSecondary">Kelola slot anak & PIN pairing</p>
            </div>
          </Link>
          {/* APK Download */}
          <Link href="/dashboard/apk"
            className="flex items-center gap-3 p-4 glass-card rounded-xl border border-accentBlue/20 hover:border-accentBlue/40 hover:bg-accentBlue/5 transition-all group">
            <div className="p-2.5 bg-accentBlue/10 rounded-xl group-hover:bg-accentBlue/20 transition-colors">
              <Download size={18} className="text-accentBlue" />
            </div>
            <div>
              <p className="text-sm font-bold text-textPrimary">Unduh APK Agent</p>
              <p className="text-[11px] text-textSecondary">Upload & download versi APK</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Sign out */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-bold mb-3">Keluar dari Akun</h3>
        <button
          onClick={handleSignOut}
          disabled={loggingOut}
          className="flex items-center gap-2.5 px-5 py-2.5 bg-accentRed/10 text-accentRed border border-accentRed/30 rounded-xl text-sm font-bold hover:bg-accentRed/20 transition-colors disabled:opacity-50"
        >
          {loggingOut ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />}
          {loggingOut ? 'Keluar...' : 'Keluar dari Semua Sesi'}
        </button>
      </div>
    </div>
  );
}
