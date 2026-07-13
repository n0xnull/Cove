'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, Search, MessageSquare, Loader2, RefreshCw, Mail, ArrowUpRight, ArrowDownLeft, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface SmsLog {
  id: string;
  sender_number: string;
  message_body: string;
  is_sent: boolean;
  is_suspicious: boolean;
  recorded_at: string;
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

export default function SmsLogsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [device, setDevice] = useState<any>(null);
  const [smsGroups, setSmsGroups] = useState<Record<string, SmsLog[]>>({});
  const [senderNumbers, setSenderNumbers] = useState<string[]>([]);
  const [activeSender, setActiveSender] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleDelete = async (id: string, senderNumber: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    setSmsGroups(prev => {
      const updated = { ...prev };
      if (updated[senderNumber]) {
        updated[senderNumber] = updated[senderNumber].filter(m => m.id !== id);
        if (updated[senderNumber].length === 0) {
          delete updated[senderNumber];
          setSenderNumbers(p => p.filter(n => n !== senderNumber));
        }
      }
      return updated;
    });
    await supabase.from('sms_logs').delete().eq('id', id);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const processSms = useCallback((data: SmsLog[]) => {
    // Deduplicate: same sender + body + direction within 5-second window
    const seen = new Map<string, number>();
    const deduped = data.filter(log => {
      const bucket = Math.floor(new Date(log.recorded_at).getTime() / 5000);
      const key = `${log.sender_number}|${log.is_sent}|${log.message_body}|${bucket}`;
      if (seen.has(key)) return false;
      seen.set(key, 1);
      return true;
    });

    const grouped: Record<string, SmsLog[]> = {};
    deduped.forEach(log => {
      const sender = log.sender_number || 'Unknown';
      if (!grouped[sender]) grouped[sender] = [];
      grouped[sender].push(log);
    });
    setSmsGroups(grouped);
    const sorted = Object.keys(grouped).sort((a, b) => {
      const la = grouped[a][grouped[a].length - 1].recorded_at;
      const lb = grouped[b][grouped[b].length - 1].recorded_at;
      return new Date(lb).getTime() - new Date(la).getTime();
    });
    setSenderNumbers(sorted);
    return sorted;
  }, []);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || device;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('sms_logs')
        .select('*')
        .eq('device_id', target.id)
        .order('recorded_at', { ascending: true })
        .limit(1000);
      if (error) {
        setErrorMsg(`Gagal memuat SMS: ${error.message}`);
      } else if (data) {
        const sorted = processSms(data);
        setActiveSender(prev => (prev && sorted.includes(prev) ? prev : sorted[0] ?? ''));
        setLastUpdated(new Date());
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(`Network error: ${err?.message ?? err}`);
    } finally {
      setRefreshing(false);
    }
  }, [device, processSms]);

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
    const channel = supabase.channel(`sms-${device.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_logs', filter: `device_id=eq.${device.id}` }, () => {
        fetchData(device, true);
      }).subscribe();
    const poll = setInterval(() => fetchData(device, true), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [device, fetchData]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [smsGroups, activeSender]);

  const filteredSenders = senderNumbers.filter(num =>
    num.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (smsGroups[num]?.[0]?.message_body || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeMessages = activeSender ? (smsGroups[activeSender] ?? []) : [];
  const totalSms = Object.values(smsGroups).flat().length;
  const suspiciousCount = Object.values(smsGroups).flat().filter(m => m.is_suspicious).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Memuat riwayat SMS...</p>
      </div>
    );
  }

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('sms_logs').delete().eq('device_id', device.id);
      await fetchData();
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Riwayat SMS</h1>
          <p className="text-textSecondary mt-1 text-sm">
            Menampilkan SMS masuk & keluar dari perangkat anak
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-textSecondary/70 hidden sm:inline">
              Update: {lastUpdated.toLocaleTimeString('id-ID')}
            </span>
          )}
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua SMS'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-sm shrink-0">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300">{errorMsg}</p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 shrink-0">
        <div className="glass-card rounded-xl p-3 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">Total SMS</span>
          <span className="text-xl font-bold mt-1 text-violetLight">{totalSms}</span>
        </div>
        <div className="glass-card rounded-xl p-3 flex flex-col justify-center">
          <span className="text-[10px] text-textSecondary font-bold uppercase tracking-wider">SMS Mencurigakan</span>
          <span className="text-xl font-bold mt-1 text-accentRed">{suspiciousCount}</span>
        </div>
      </div>

      {/* Main chat window */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Left column: Senders list */}
        <div className="w-80 glass-card rounded-2xl flex flex-col overflow-hidden shrink-0">
          <div className="p-3 border-b border-borderDark/60 space-y-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Cari pengirim atau pesan..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-darkBg border border-borderDark rounded-xl pl-9 pr-3 py-2 text-xs text-textPrimary focus:outline-none focus:border-accentViolet focus:ring-1 focus:ring-accentViolet/30"
              />
              <Search className="absolute left-3 top-2.5 text-textSecondary" size={14} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-borderDark/30">
            {filteredSenders.length === 0 ? (
              <div className="p-8 text-center text-xs text-textSecondary italic">
                Tidak ada SMS ditemukan
              </div>
            ) : (
              filteredSenders.map(num => {
                const group = smsGroups[num];
                const last = group[group.length - 1];
                const unreadSuspicious = group.some(m => m.is_suspicious);
                const isActive = num === activeSender;
                return (
                  <button
                    key={num}
                    onClick={() => setActiveSender(num)}
                    className={`w-full text-left p-4 flex gap-3 transition-colors ${
                      isActive ? 'bg-accentViolet/10 border-r-2 border-accentViolet' : 'hover:bg-cardBg/40'
                    }`}
                  >
                    <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0 h-10 w-10 flex items-center justify-center">
                      <Mail size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-bold text-xs text-textPrimary truncate">{num}</span>
                        <span className="text-[9px] text-textSecondary shrink-0">{timeAgo(last.recorded_at)}</span>
                      </div>
                      <p className="text-[11px] text-textSecondary truncate mt-1">{last.message_body}</p>
                      {unreadSuspicious && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-accentRed mt-1 bg-accentRed/10 border border-accentRed/25 px-1.5 py-0.5 rounded">
                          <AlertTriangle size={10} /> MENCURIGAKAN
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Conversation bubble stream */}
        <div className="flex-1 glass-card rounded-2xl flex flex-col overflow-hidden">
          {activeSender ? (
            <>
              {/* Active Header */}
              <div className="p-4 border-b border-borderDark/60 flex items-center justify-between shrink-0 bg-cardBg/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    <Mail size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-textPrimary">{activeSender}</h3>
                    <p className="text-[10px] text-textSecondary">{activeMessages.length} pesan diurutkan berdasarkan waktu</p>
                  </div>
                </div>
              </div>

              {/* Message Stream */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-darkBg/10">
                {activeMessages.map((msg) => (
                  <div key={msg.id} className={`group flex items-end gap-2 ${msg.is_sent ? 'justify-end' : 'justify-start'}`}>
                    {/* Delete button left of bubble (incoming) */}
                    {!msg.is_sent && (
                      <button
                        onClick={() => handleDelete(msg.id, activeSender)}
                        disabled={deletingIds.has(msg.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-textSecondary/50 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 mb-4 shrink-0"
                        title="Hapus pesan ini"
                      >
                        {deletingIds.has(msg.id) ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    )}
                    <div className="max-w-[70%] space-y-1">
                      <div className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed border ${
                        msg.is_sent
                          ? 'bg-accentViolet/20 text-violetLight border-accentViolet/30 rounded-tr-none'
                          : 'bg-cardBg text-textPrimary border-borderDark rounded-tl-none'
                      } ${msg.is_suspicious ? 'border-accentRed/50 bg-accentRed/10' : ''}`}>
                        <p className="whitespace-pre-wrap">{msg.message_body}</p>
                      </div>

                      <div className={`flex items-center gap-2 text-[9px] text-textSecondary/70 ${msg.is_sent ? 'justify-end' : 'justify-start'}`}>
                        <span>{new Date(msg.recorded_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          {msg.is_sent ? (
                            <>Keluar <ArrowUpRight size={10} className="text-violetLight" /></>
                          ) : (
                            <>Masuk <ArrowDownLeft size={10} className="text-emerald-400" /></>
                          )}
                        </span>
                        {msg.is_suspicious && (
                          <>
                            <span>·</span>
                            <span className="text-accentRed font-bold flex items-center gap-0.5">
                              <AlertTriangle size={10} /> Sensitif
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Delete button right of bubble (outgoing) */}
                    {msg.is_sent && (
                      <button
                        onClick={() => handleDelete(msg.id, activeSender)}
                        disabled={deletingIds.has(msg.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-textSecondary/50 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 mb-4 shrink-0"
                        title="Hapus pesan ini"
                      >
                        {deletingIds.has(msg.id) ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-textSecondary/60 gap-2">
              <MessageSquare size={36} className="opacity-40" />
              <p className="text-sm italic">Pilih nomor pengirim di bilah kiri untuk membuka riwayat SMS</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
