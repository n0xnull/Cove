'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { KeyRound, Mail, Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { signIn } from '../../lib/supabase';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(email, password);
      const redirect = searchParams.get('redirect') || '/dashboard';
      router.push(redirect);
    } catch (err: any) {
      setError(err.message || 'Email atau kata sandi salah. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-darkBg flex items-center justify-center p-4 relative overflow-hidden">
      {/* V2: Violet decorative gradients */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accentViolet/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accentBlue/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Login Card */}
      <div className="relative w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl shadow-black/50">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Image src="/cove-icon-256.png" alt="Cove" width={72} height={72} className="rounded-2xl" priority />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-violetLight to-accentBlue bg-clip-text text-transparent">
            Cove
          </h1>
          <p className="text-sm text-textSecondary mt-1.5 text-center">
            Panel Pengawasan Orang Tua — Masuk untuk melanjutkan
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-5 flex items-start gap-3 p-3.5 bg-accentRed/10 border border-accentRed/30 rounded-xl text-sm text-accentRed">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
              Email Orang Tua
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-textSecondary pointer-events-none">
                <Mail size={16} />
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ortu@email.com"
                className="w-full bg-darkBg/80 border border-borderDark rounded-xl py-2.5 pl-10 pr-4 text-sm text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30 transition-colors"
              />
            </div>
          </div>

          {/* Password input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
              Kata Sandi
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-textSecondary pointer-events-none">
                <KeyRound size={16} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-darkBg/80 border border-borderDark rounded-xl py-2.5 pl-10 pr-12 text-sm text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-textSecondary hover:text-textPrimary transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accentViolet hover:bg-accentViolet/90 disabled:bg-accentViolet/50 text-white font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 mt-2 shadow-lg shadow-accentViolet/20"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Menghubungkan...
              </>
            ) : (
              'Masuk ke Panel'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-textSecondary/70">
            Cove v1.0 — Kompatibel dengan Agent WebView Sync
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-darkBg flex items-center justify-center"><div className="text-textSecondary text-sm">Memuat...</div></div>}>
      <LoginForm />
    </Suspense>
  );
}
