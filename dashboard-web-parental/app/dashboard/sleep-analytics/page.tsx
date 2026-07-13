'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Phone, Mail, Loader2, RefreshCw, BarChart3, Clock, UserCheck, TrendingUp, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface CallLog {
  id: string; phone_number: string; contact_name: string; direction: string; duration_seconds: number; recorded_at: string;
}

interface SmsLog {
  id: string; sender_number: string; is_sent: boolean; recorded_at: string;
}

interface TopCommunicator {
  nameOrNumber: string; type: 'Call' | 'SMS' | 'Call & SMS'; count: number;
}

export default function CommunicationAnalyticsPage() {
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [device, setDevice]           = useState<any>(null);
  const [calls, setCalls]             = useState<CallLog[]>([]);
  const [smsLogs, setSmsLogs]         = useState<SmsLog[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const deviceRef = useRef<any>(null);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || deviceRef.current;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const [callsRes, smsRes] = await Promise.all([
        supabase.from('calls').select('*').eq('device_id', target.id).order('recorded_at', { ascending: false }).limit(500),
        supabase.from('sms_logs').select('*').eq('device_id', target.id).order('recorded_at', { ascending: false }).limit(500)
      ]);

      if (callsRes.data) setCalls(callsRes.data);
      if (smsRes.data) setSmsLogs(smsRes.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching analytics data:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (!data?.length) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem('selected_device_id') : null;
        const dev = data.find((d: any) => d.id === saved) || data[0];
        setDevice(dev); deviceRef.current = dev;
        await fetchData(dev);
      } finally { setLoading(false); }
    };
    init();
  }, [fetchData]);

  // Calculations
  const totalCalls = calls.length;
  const incomingCalls = calls.filter(c => c.direction === 'INCOMING').length;
  const outgoingCalls = calls.filter(c => c.direction === 'OUTGOING').length;
  const missedCalls = calls.filter(c => c.direction === 'MISSED' || c.direction === 'REJECTED').length;

  const totalSms = smsLogs.length;
  const sentSms = smsLogs.filter(s => s.is_sent).length;
  const receivedSms = smsLogs.filter(s => !s.is_sent).length;

  // Average Call Duration
  const totalDuration = calls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
  const avgCallDurationMins = totalCalls > 0 ? Math.round((totalDuration / totalCalls) / 60) : 0;

  // Top Communicators (Call + SMS combined)
  const communicators: Record<string, { count: number; type: 'Call' | 'SMS' | 'Call & SMS'; callCount: number; smsCount: number }> = {};
  
  calls.forEach(c => {
    const key = c.contact_name || c.phone_number;
    if (!key) return;
    if (!communicators[key]) communicators[key] = { count: 0, type: 'Call', callCount: 0, smsCount: 0 };
    communicators[key].count++;
    communicators[key].callCount++;
  });

  smsLogs.forEach(s => {
    const key = s.sender_number;
    if (!key) return;
    if (!communicators[key]) communicators[key] = { count: 0, type: 'SMS', callCount: 0, smsCount: 0 };
    communicators[key].count++;
    communicators[key].smsCount++;
  });

  const topCommunicators: TopCommunicator[] = Object.entries(communicators)
    .map(([name, data]) => {
      let t: 'Call' | 'SMS' | 'Call & SMS' = 'Call';
      if (data.callCount > 0 && data.smsCount > 0) t = 'Call & SMS';
      else if (data.smsCount > 0) t = 'SMS';
      return { nameOrNumber: name, type: t, count: data.count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Hourly volume distribution (calls + SMS combined)
  const hourlyVolume = Array(24).fill(0);
  calls.forEach(c => {
    const hour = new Date(c.recorded_at).getHours();
    hourlyVolume[hour]++;
  });
  smsLogs.forEach(s => {
    const hour = new Date(s.recorded_at).getHours();
    hourlyVolume[hour]++;
  });

  const maxVolume = Math.max(...hourlyVolume, 1);

  if (loading && !device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-textSecondary">
        <Loader2 className="animate-spin text-accentViolet" size={36} />
        <p className="text-sm">Menghubungkan ke database...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analisis Komunikasi</h1>
          <p className="text-textSecondary mt-1.5">Hubungkan perangkat anak untuk melihat statistik komunikasi.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analisis Komunikasi</h1>
          <p className="text-textSecondary mt-1.5">
            Analisis frekuensi dan pola panggilan telepon serta SMS untuk perangkat <strong>{device.device_name}</strong>.
          </p>
        </div>
        <button 
          onClick={() => fetchData()}
          className="flex items-center gap-2 px-4 py-2 bg-cardBg border border-borderDark rounded-xl hover:bg-darkBg transition-colors text-sm font-semibold"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          Segarkan Data
        </button>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Panggilan', value: totalCalls, subtitle: `${incomingCalls} Masuk · ${outgoingCalls} Keluar`, icon: Phone, color: 'text-accentViolet' },
          { label: 'Durasi Rerata', value: `${avgCallDurationMins} Menit`, subtitle: 'Per panggilan telepon', icon: Clock, color: 'text-accentGreen' },
          { label: 'Total SMS', value: totalSms, subtitle: `${receivedSms} Diterima · ${sentSms} Dikirim`, icon: Mail, color: 'text-accentBlue' },
          { label: 'Panggilan Tak Terjawab', value: missedCalls, subtitle: 'Missed & Rejected', icon: PhoneMissed, color: 'text-accentRed' }
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="glass-card rounded-xl p-5 flex items-start gap-4">
              <span className={`p-2.5 bg-darkBg/60 border border-borderDark rounded-xl ${stat.color}`}>
                <Icon size={20} />
              </span>
              <div>
                <p className="text-[10px] text-textSecondary uppercase tracking-wider font-semibold">{stat.label}</p>
                <p className="text-2xl font-bold text-textPrimary mt-0.5">{stat.value}</p>
                <p className="text-[10px] text-textSecondary mt-1 font-semibold">{stat.subtitle}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Top Contacts */}
        <div className="glass-card rounded-2xl p-5 space-y-4 lg:col-span-1">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <UserCheck className="text-accentViolet" size={16} /> Interaksi Kontak Terbanyak
          </h2>
          <p className="text-xs text-textSecondary">
            Kontak atau nomor telepon dengan volume telepon & SMS gabungan tertinggi.
          </p>
          <div className="space-y-3 pt-2">
            {topCommunicators.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-darkBg/40 border border-borderDark/40 rounded-xl hover:border-borderDark transition-colors">
                <div>
                  <p className="text-xs font-bold text-textPrimary font-mono truncate max-w-[150px]">{c.nameOrNumber}</p>
                  <p className="text-[9px] text-textSecondary font-semibold mt-0.5">{c.type}</p>
                </div>
                <span className="text-xs font-bold text-accentViolet bg-accentViolet/10 px-2 py-0.5 rounded-full">
                  {c.count} Interaksi
                </span>
              </div>
            ))}
            {topCommunicators.length === 0 && (
              <p className="text-xs text-textSecondary text-center py-10">Belum ada riwayat percakapan.</p>
            )}
          </div>
        </div>

        {/* Hourly Volume */}
        <div className="glass-card rounded-2xl p-5 space-y-4 lg:col-span-2">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <BarChart3 className="text-accentViolet" size={16} /> Jam Sibuk Komunikasi (24 Jam)
          </h2>
          <p className="text-xs text-textSecondary">
            Frekuensi total panggilan telepon dan SMS berdasarkan waktu dalam 24 jam terakhir.
          </p>
          
          <div className="flex items-end justify-between gap-1 h-44 border-b border-borderDark/60 pb-2 pt-4">
            {hourlyVolume.map((vol, hour) => {
              const pct = (vol / maxVolume) * 100;
              const isLateNight = hour >= 22 || hour <= 4;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full relative flex justify-center items-end h-32">
                    <span className="absolute -top-6 text-[8px] font-semibold text-textSecondary opacity-0 group-hover:opacity-100 transition-opacity">
                      {vol}
                    </span>
                    <div 
                      style={{ height: `${pct || 3}%` }} 
                      className={`w-full rounded-t-sm transition-all duration-300 ${
                        isLateNight && vol > 0 ? 'bg-accentRed/70 hover:bg-accentRed' : 'bg-accentViolet/60 hover:bg-accentViolet'
                      }`}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-textSecondary leading-none">{hour.toString().padStart(2, '0')}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-textSecondary px-1 font-semibold pt-1">
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-accentViolet/60 rounded" /> Jam Siang</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-accentRed/70 rounded" /> Aktivitas Larut Malam (22:00 - 04:00)</div>
          </div>
        </div>

      </div>

      {/* Call Breakdown & SMS Breakdown grids */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Call Direction Pie Chart Approximation */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Phone className="text-accentGreen" size={16} /> Distribusi Panggilan
          </h2>
          <div className="space-y-3 pt-2">
            {[
              { label: 'Panggilan Masuk (Incoming)', count: incomingCalls, pct: totalCalls > 0 ? Math.round((incomingCalls / totalCalls) * 100) : 0, color: 'bg-accentGreen' },
              { label: 'Panggilan Keluar (Outgoing)', count: outgoingCalls, pct: totalCalls > 0 ? Math.round((outgoingCalls / totalCalls) * 100) : 0, color: 'bg-accentViolet' },
              { label: 'Tak Terjawab (Missed/Rejected)', count: missedCalls, pct: totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100) : 0, color: 'bg-accentRed' }
            ].map((d, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-textSecondary">{d.label}</span>
                  <span className="text-textPrimary">{d.count} ({d.pct}%)</span>
                </div>
                <div className="w-full bg-darkBg/60 h-2 rounded-full overflow-hidden border border-borderDark/20">
                  <div className={`h-full ${d.color} rounded-full`} style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SMS Direction Breakdown */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Mail className="text-accentBlue" size={16} /> Distribusi SMS
          </h2>
          <div className="space-y-3 pt-2">
            {[
              { label: 'SMS Diterima (Inbox)', count: receivedSms, pct: totalSms > 0 ? Math.round((receivedSms / totalSms) * 100) : 0, color: 'bg-accentBlue' },
              { label: 'SMS Dikirim (Sent)', count: sentSms, pct: totalSms > 0 ? Math.round((sentSms / totalSms) * 100) : 0, color: 'bg-accentViolet' }
            ].map((d, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-textSecondary">{d.label}</span>
                  <span className="text-textPrimary">{d.count} ({d.pct}%)</span>
                </div>
                <div className="w-full bg-darkBg/60 h-2 rounded-full overflow-hidden border border-borderDark/20">
                  <div className={`h-full ${d.color} rounded-full`} style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
