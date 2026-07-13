'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, Plus, Copy, Check, Loader2, AlertTriangle, Trash2,
  RefreshCw, Smartphone, SmartphoneNfc, ShieldCheck, KeyRound,
  ChevronRight, Baby, WifiOff,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface ChildSlot {
  id: string;
  parent_id: string;
  name: string;
  setup_pin: string;
  created_at: string;
  // joined from devices
  device?: {
    id: string;
    device_name: string;
    status: string;
    battery_level: number;
    last_heartbeat_at: string;
    agent_mode: string;
  } | null;
}

// Generate PIN: 8 chars from unambiguous charset (no 0/O/1/I/L)
function generatePin(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let pin = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  arr.forEach(b => { pin += chars[b % chars.length]; });
  return pin;
}

function formatPin(pin: string): string {
  // Format as XXXX-XXXX for readability
  return pin.length === 8 ? `${pin.slice(0, 4)}-${pin.slice(4)}` : pin;
}

function timeAgo(iso: string) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 2)   return 'Baru saja';
  if (m < 60)  return `${Math.floor(m)} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function isOnline(iso?: string): boolean {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) < 3 * 60 * 1000;
}

export default function ChildrenPage() {
  const [loading, setLoading]         = useState(true);
  const [children, setChildren]       = useState<ChildSlot[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [user, setUser]               = useState<any>(null);
  const [refreshing, setRefreshing]   = useState(false);

  // Add child form
  const [showForm, setShowForm]       = useState(false);
  const [newName, setNewName]         = useState('');
  const [adding, setAdding]           = useState(false);
  const [addError, setAddError]       = useState<string | null>(null);

  // Copy PIN state
  const [copiedPin, setCopiedPin]     = useState<string | null>(null);

  // Delete confirm
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchChildren = useCallback(async (uid?: string, silent = false) => {
    const parentId = uid || user?.id;
    if (!parentId) return;
    if (!silent) setRefreshing(true);
    try {
      // Fetch children slots
      const { data: slots, error: e } = await supabase
        .from('children')
        .select('*')
        .eq('parent_id', parentId)
        .order('created_at', { ascending: true });
      if (e) throw e;

      // For each slot, find paired device (if any)
      if (slots && slots.length > 0) {
        const { data: devices } = await supabase
          .from('devices')
          .select('id, device_name, status, battery_level, last_heartbeat_at, agent_mode, child_id')
          .eq('parent_id', parentId);

        const deviceByChildId: Record<string, any> = {};
        (devices || []).forEach(d => {
          if (d.child_id) deviceByChildId[d.child_id] = d;
        });

        setChildren(slots.map((s: any) => ({
          ...s,
          device: deviceByChildId[s.id] ?? null,
        })));
      } else {
        setChildren([]);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data');
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        setUser(u);
        await fetchChildren(u?.id, true);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) { setAddError('Nama anak tidak boleh kosong'); return; }
    setAdding(true); setAddError(null);
    try {
      // Generate unique PIN
      let pin = generatePin();
      // Retry if collision (extremely rare)
      for (let i = 0; i < 5; i++) {
        const { data: existing } = await supabase.from('children').select('id').eq('setup_pin', pin).maybeSingle();
        if (!existing) break;
        pin = generatePin();
      }
      const { error: e } = await supabase.from('children').insert({
        parent_id: user.id,
        name: newName.trim(),
        setup_pin: pin,
      });
      if (e) throw e;
      setNewName('');
      setShowForm(false);
      await fetchChildren(user.id, true);
    } catch (err: any) {
      setAddError(err?.message ?? 'Gagal menambah anak');
    } finally { setAdding(false); }
  };

  const handleCopyPin = async (pin: string) => {
    await navigator.clipboard.writeText(pin);
    setCopiedPin(pin);
    setTimeout(() => setCopiedPin(null), 2500);
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setDeletingId(id);
    setConfirmDeleteId(null);
    // Unlink devices from this child slot first
    await supabase.from('devices').update({ child_id: null, child_name: '' }).eq('child_id', id);
    await supabase.from('children').delete().eq('id', id);
    setChildren(prev => prev.filter(c => c.id !== id));
    setDeletingId(null);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
      <Loader2 className="animate-spin text-accentViolet" size={36} />
      <p className="text-sm">Memuat daftar anak...</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daftar Anak</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Kelola slot anak dan PIN pairing untuk setiap perangkat
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchChildren(user?.id)}
            className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setShowForm(true); setAddError(null); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-accentViolet text-white rounded-xl text-sm font-bold hover:bg-accentViolet/80 transition-all">
            <Plus size={15} /> Tambah Anak
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      {/* How-to banner */}
      <div className="glass-card rounded-2xl p-5 border border-accentViolet/20 bg-accentViolet/5">
        <p className="text-xs font-bold text-violetLight mb-3 uppercase tracking-wider">Cara Menghubungkan HP Anak</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            { n: 1, t: 'Tambah slot anak', d: 'Klik "Tambah Anak", isi nama' },
            { n: 2, t: 'Salin PIN', d: 'Klik ikon salin di card anak' },
            { n: 3, t: 'Install APK', d: 'Download & install di HP anak (Profil → Unduh APK)' },
            { n: 4, t: 'Masukkan PIN', d: 'Buka app di HP anak, ketik PIN 8 karakter' },
          ].map(s => (
            <div key={s.n} className="flex items-start gap-2.5">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accentViolet text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                {s.n}
              </span>
              <div>
                <p className="text-xs font-semibold text-textPrimary">{s.t}</p>
                <p className="text-[10px] text-textSecondary/80 mt-0.5">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add child form */}
      {showForm && (
        <div className="glass-card rounded-2xl p-5 border border-accentViolet/30 space-y-4">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Baby size={16} className="text-accentViolet" /> Tambah Slot Anak Baru
          </h2>
          <div className="flex gap-3">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder='Nama anak, contoh: "Anak Pertama" atau "Budi"'
              className="flex-1 px-4 py-2.5 text-sm bg-darkBg border border-borderDark rounded-xl text-textPrimary placeholder-textSecondary/40 focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
            />
            <button onClick={handleAdd} disabled={adding}
              className="px-5 py-2.5 bg-accentViolet text-white rounded-xl text-sm font-bold hover:bg-accentViolet/80 disabled:opacity-50 transition-all flex items-center gap-2">
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {adding ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => { setShowForm(false); setNewName(''); setAddError(null); }}
              className="px-4 py-2.5 glass-card rounded-xl text-sm text-textSecondary hover:text-textPrimary transition-all">
              Batal
            </button>
          </div>
          {addError && <p className="text-xs text-accentRed">{addError}</p>}
        </div>
      )}

      {/* Children list */}
      {children.length === 0 && !showForm ? (
        <div className="glass-card rounded-2xl p-14 text-center space-y-3">
          <Users size={44} className="text-textSecondary/20 mx-auto" />
          <p className="text-sm font-medium text-textSecondary">Belum ada anak yang ditambahkan.</p>
          <p className="text-xs text-textSecondary/60">Klik "Tambah Anak" untuk membuat slot pertama.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {children.map(child => {
            const paired   = !!child.device;
            const online   = paired && isOnline(child.device?.last_heartbeat_at);
            const isDeleting = deletingId === child.id;
            const confirmingDelete = confirmDeleteId === child.id;

            return (
              <div key={child.id} className={`glass-card rounded-2xl p-5 space-y-4 ${paired ? 'border border-accentGreen/20' : ''}`}>
                {/* Top row: name + status + delete */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${paired ? 'bg-accentGreen/10' : 'bg-cardBg'}`}>
                      <Baby size={20} className={paired ? 'text-accentGreen' : 'text-textSecondary/40'} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-textPrimary">{child.name}</h3>
                      <p className="text-[10px] text-textSecondary/60">
                        Dibuat {new Date(child.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    {/* Paired badge */}
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                      paired
                        ? online
                          ? 'bg-accentGreen/10 text-accentGreen'
                          : 'bg-cardBg text-textSecondary'
                        : 'bg-accentYellow/10 text-accentYellow'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-accentGreen animate-pulse' : paired ? 'bg-textSecondary' : 'bg-accentYellow'}`} />
                      {paired ? (online ? 'Online' : 'Offline') : 'Belum Dipasangkan'}
                    </span>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(child.id)}
                    disabled={isDeleting}
                    onMouseLeave={() => setConfirmDeleteId(null)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 ${
                      confirmingDelete
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'glass-card text-textSecondary/50 hover:text-accentRed hover:bg-red-950/20'
                    }`}
                    title="Hapus slot anak"
                  >
                    {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {confirmingDelete ? 'Konfirmasi?' : 'Hapus'}
                  </button>
                </div>

                {/* PIN section */}
                <div className="flex items-center gap-3 p-3.5 bg-darkBg/60 rounded-xl border border-borderDark/60">
                  <div className="p-2 rounded-lg bg-accentViolet/10 shrink-0">
                    <KeyRound size={14} className="text-accentViolet" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] text-textSecondary uppercase font-bold tracking-wider mb-0.5">PIN Setup</p>
                    <code className="text-lg font-mono font-bold text-violetLight tracking-[0.2em]">
                      {formatPin(child.setup_pin)}
                    </code>
                  </div>
                  <button
                    onClick={() => handleCopyPin(child.setup_pin)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                      copiedPin === child.setup_pin
                        ? 'bg-accentGreen/10 text-accentGreen border-accentGreen/30'
                        : 'bg-accentViolet/10 text-violetLight border-accentViolet/30 hover:bg-accentViolet/20'
                    }`}
                  >
                    {copiedPin === child.setup_pin ? <><Check size={12} /> Disalin!</> : <><Copy size={12} /> Salin PIN</>}
                  </button>
                </div>

                {/* Device info (if paired) */}
                {paired && child.device && (
                  <div className="flex items-center gap-3 p-3 bg-accentGreen/5 rounded-xl border border-accentGreen/15">
                    <Smartphone size={16} className="text-accentGreen shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-textPrimary">{child.device.device_name}</p>
                      <p className="text-[10px] text-textSecondary">
                        🔋 {child.device.battery_level}%
                        {child.device.last_heartbeat_at && ` · ${timeAgo(child.device.last_heartbeat_at)}`}
                        {child.device.agent_mode !== 'ACTIVE' && ` · ${child.device.agent_mode}`}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-textSecondary/40 shrink-0" />
                  </div>
                )}

                {/* Unpaired hint */}
                {!paired && (
                  <div className="flex items-center gap-2 p-3 bg-accentYellow/5 rounded-xl border border-accentYellow/15">
                    <SmartphoneNfc size={15} className="text-accentYellow shrink-0" />
                    <p className="text-[11px] text-accentYellow/80">
                      Salin PIN di atas → install APK di HP anak → buka app → masukkan PIN
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
