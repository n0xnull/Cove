'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Wifi, RefreshCw, Loader2, Clock, Navigation, AlertTriangle, Calendar, CheckCircle2, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface GpsLog {
  id: number; device_id: string; latitude: number; longitude: number; recorded_at: string;
}
interface WifiLog {
  id: number; device_id: string; ssid: string; bssid: string; connected_at: string;
}
interface WifiGroup { ssid: string; bssid: string; count: number; lastSeen: string; }

type DateFilter = '1d' | '7d' | '30d';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// Free satellite style using ESRI World Imagery (no token needed)
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri, Maxar, GeoEye, USDA, USGS, AeroGRID, IGN',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'satellite-bg', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 22 },
    { id: 'labels-overlay', type: 'raster', source: 'labels', minzoom: 0, maxzoom: 22 },
  ],
};

// Free dark street style via CARTO (no token needed)
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function TrackingPage() {
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [device, setDevice]           = useState<any>(null);
  const [gpsLogs, setGpsLogs]         = useState<GpsLog[]>([]);
  const [wifiLogs, setWifiLogs]       = useState<WifiLog[]>([]);
  const [mapLoaded, setMapLoaded]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [dateFilter, setDateFilter]   = useState<DateFilter>('7d');
  const [mapStyle, setMapStyle]       = useState<'satellite' | 'dark'>('satellite');

  const [triggeringSync, setTriggeringSync] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<any>(null);
  const markersRef      = useRef<any[]>([]);
  const deviceRef       = useRef<any>(null);

  const handleRefreshFromPhone = async () => {
    const target = device || deviceRef.current;
    if (!target || triggeringSync) return;
    setTriggeringSync(true);
    setSyncSuccess(false);
    try {
      const { data, error } = await supabase
        .from('screenshot_commands')
        .insert({
          device_id: target.id,
          command_type: 'LOCATION',
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
            fetchData(target);
            setTimeout(() => setSyncSuccess(false), 3000);
          } else if (cmd.status === 'FAILED' || attempts > 20) {
            clearInterval(interval);
            setTriggeringSync(false);
            alert('Gagal menyinkronkan data lokasi dari HP anak. Pastikan HP anak aktif dan GPS menyala.');
          }
        }
      }, 2000);

    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Gagal mengirim perintah sinkronisasi lokasi');
      setTriggeringSync(false);
    }
  };

  const wifiGroups: WifiGroup[] = Object.values(
    wifiLogs.reduce((acc: Record<string, WifiGroup>, log) => {
      const k = log.bssid;
      if (!acc[k]) acc[k] = { ssid: log.ssid, bssid: log.bssid, count: 0, lastSeen: log.connected_at };
      acc[k].count++;
      if (new Date(log.connected_at) > new Date(acc[k].lastSeen)) acc[k].lastSeen = log.connected_at;
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  const getSince = (f: DateFilter) => {
    const d = f === '1d' ? 1 : f === '7d' ? 7 : 30;
    return new Date(Date.now() - d * 86400000).toISOString();
  };

  const [clearingAll, setClearingAll]   = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchData = useCallback(async (dev?: any, silent = false) => {
    const target = dev || deviceRef.current;
    if (!target) return;
    if (!silent) setRefreshing(true);
    try {
      const [gpsRes, wifiRes] = await Promise.all([
        supabase.from('location_logs').select('*').eq('device_id', target.id)
          .gte('recorded_at', getSince(dateFilter)).order('recorded_at', { ascending: false }).limit(500),
        supabase.from('wifi_history_logs').select('*').eq('device_id', target.id)
          .gte('connected_at', getSince(dateFilter)).order('connected_at', { ascending: false }).limit(200),
      ]);
      if (gpsRes.data)  setGpsLogs(gpsRes.data);
      if (wifiRes.data) setWifiLogs(wifiRes.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    } finally { setRefreshing(false); }
  }, [dateFilter]);

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

  useEffect(() => { fetchData(); }, [dateFilter]);

  useEffect(() => {
    if (!device) return;
    const ch = supabase.channel(`tracking-${device.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_logs',     filter: `device_id=eq.${device.id}` }, () => fetchData(device, true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wifi_history_logs', filter: `device_id=eq.${device.id}` }, () => fetchData(device, true))
      .subscribe();
    const poll = setInterval(() => fetchData(device, true), 30000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [device, fetchData]);

  // Load MapLibre GL JS via CDN (free, open source)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).maplibregl) { setMapLoaded(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    script.onload  = () => setMapLoaded(true);
    script.onerror = () => setError('MapLibre GL JS gagal dimuat. Periksa koneksi internet.');
    document.head.appendChild(script);
  }, []);

  // Initialize map — depends on both mapLoaded AND loading so it fires
  // only after the map container div is actually in the DOM.
  // (The early return `if (loading)` above hides the container while fetching data,
  //  so we must re-run this effect when loading transitions to false.)
  useEffect(() => {
    if (!mapLoaded || loading || !mapContainerRef.current || mapRef.current) return;
    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: SATELLITE_STYLE as any,
      center: [107.6191, -6.9175],
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapLoaded, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update GPS trail + markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || gpsLogs.length === 0) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    ['trail-line'].forEach(id => { try { map.removeLayer(id); } catch (_) {} });
    ['trail-source'].forEach(id => { try { map.removeSource(id); } catch (_) {} });

    const sorted = [...gpsLogs].sort((a, b) =>
      new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );

    const addLayers = () => {
      if (!map.isStyleLoaded()) { setTimeout(addLayers, 150); return; }
      const maplibregl = (window as any).maplibregl;
      if (!maplibregl) return;

      // Trail line
      map.addSource('trail-source', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: sorted.map(p => [p.longitude, p.latitude]) } },
      });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail-source',
        paint: { 'line-color': '#a78bfa', 'line-width': 3, 'line-opacity': 0.85 } });

      // Intermediate dot markers
      sorted.slice(0, -1).forEach(log => {
        const el = document.createElement('div');
        el.style.cssText = 'width:8px;height:8px;background:#7c3aed;border-radius:50%;border:2px solid rgba(167,139,250,0.5);cursor:pointer;';
        const m = new maplibregl.Marker({ element: el })
          .setLngLat([log.longitude, log.latitude])
          .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
            `<div style="font:12px sans-serif;color:#111"><b>${timeAgo(log.recorded_at)}</b><br/>${log.latitude.toFixed(6)}, ${log.longitude.toFixed(6)}</div>`
          )).addTo(map);
        markersRef.current.push(m);
      });

      // Latest position — glowing green marker
      const latest = sorted[sorted.length - 1];
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;background:#10b981;border-radius:50%;animation:ping 1.5s ease-in-out infinite;opacity:0.6;transform-origin:center;"></div>
          <div style="position:absolute;inset:4px;background:#10b981;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(16,185,129,0.8);"></div>
        </div>
        <style>@keyframes ping{0%{transform:scale(1);opacity:0.6}70%{transform:scale(1.8);opacity:0}100%{transform:scale(2.2);opacity:0}}</style>
      `;
      const latestMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([latest.longitude, latest.latitude])
        .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(
          `<div style="font:12px sans-serif;color:#111"><b>📍 Posisi Terakhir</b><br/>${timeAgo(latest.recorded_at)}<br/>${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}</div>`
        )).addTo(map);
      markersRef.current.push(latestMarker);

      map.flyTo({ center: [latest.longitude, latest.latitude], zoom: 15, speed: 1.2, curve: 1.5 });
    };

    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
  }, [gpsLogs]);

  // Toggle map style
  const toggleMapStyle = () => {
    const map = mapRef.current; if (!map) return;
    const next = mapStyle === 'satellite' ? 'dark' : 'satellite';
    setMapStyle(next);
    map.setStyle(next === 'satellite' ? (SATELLITE_STYLE as any) : DARK_STYLE);
    // Re-add layers after style change
    map.once('styledata', () => {
      if (gpsLogs.length === 0) return;
      const sorted = [...gpsLogs].sort((a, b) =>
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );
      try {
        map.addSource('trail-source', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: sorted.map(p => [p.longitude, p.latitude]) } },
        });
        map.addLayer({ id: 'trail-line', type: 'line', source: 'trail-source',
          paint: { 'line-color': '#a78bfa', 'line-width': 3, 'line-opacity': 0.85 } });
      } catch (_) {}
    });
  };

  const handleClearAll = async () => {
    if (!device) return;
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearingAll(true);
    setConfirmClear(false);
    try {
      await supabase.from('wifi_history_logs').delete().eq('device_id', device.id);
      await supabase.from('location_logs').delete().eq('device_id', device.id);
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
      <p className="text-sm">Memuat data lokasi...</p>
    </div>
  );

  const latestGps = gpsLogs[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pelacakan Lokasi</h1>
          <p className="text-textSecondary mt-1">
            {device ? <><strong>{device.device_name}</strong>{lastUpdated && <span className="ml-2 text-xs opacity-60">· {timeAgo(lastUpdated.toISOString())}</span>}</> : 'Belum ada perangkat'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['1d','7d','30d'] as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${dateFilter === f ? 'bg-accentViolet text-white' : 'glass-card text-textSecondary hover:text-textPrimary'}`}>
              {f === '1d' ? 'Hari Ini' : f === '7d' ? '7 Hari' : '30 Hari'}
            </button>
          ))}
          {triggeringSync && (
            <span className="text-xs text-violetLight animate-pulse flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Menyinkronkan dari HP...
            </span>
          )}
          {syncSuccess && (
            <span className="text-xs text-accentGreen flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              Sinkron Berhasil!
            </span>
          )}
          <button 
            onClick={handleRefreshFromPhone} 
            disabled={triggeringSync}
            className="flex items-center gap-2 px-4 py-2 glass-card rounded-xl hover:border-borderDark disabled:opacity-50 transition-colors text-sm font-semibold text-textSecondary hover:text-textPrimary"
          >
            <RefreshCw size={16} className={triggeringSync ? 'animate-spin' : ''} />
            Minta Lokasi Terbaru
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
            {clearingAll ? 'Menghapus...' : confirmClear ? 'Konfirmasi hapus semua?' : 'Hapus Semua Lokasi'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-3 p-4 bg-red-950/30 border border-red-900/40 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs font-mono">{error}</p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Titik GPS', value: gpsLogs.length, icon: MapPin, color: 'text-accentViolet' },
          { label: 'Koordinat Terakhir', value: latestGps ? `${latestGps.latitude.toFixed(4)}, ${latestGps.longitude.toFixed(4)}` : '—', icon: Navigation, color: 'text-accentGreen' },
          { label: 'Terakhir Dilihat', value: latestGps ? timeAgo(latestGps.recorded_at) : '—', icon: Clock, color: 'text-accentYellow' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="glass-card rounded-xl p-4 flex items-center gap-3">
              <Icon size={20} className={s.color} />
              <div>
                <p className="text-[10px] text-textSecondary uppercase tracking-wider font-semibold">{s.label}</p>
                <p className="text-sm font-bold text-textPrimary mt-0.5 truncate max-w-[180px]">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Map */}
      <div className="glass-card rounded-2xl overflow-hidden relative" style={{ height: '520px' }}>
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Style toggle */}
        <button onClick={toggleMapStyle}
          className="absolute top-3 left-3 z-10 px-3 py-1.5 bg-black/70 backdrop-blur-sm text-white rounded-lg text-xs font-bold hover:bg-black/90 transition-colors">
          {mapStyle === 'satellite' ? '🗺️ Dark Mode' : '🛰️ Satellite'}
        </button>

        {/* Legend */}
        <div className="absolute bottom-3 right-3 z-10 bg-black/70 backdrop-blur-sm rounded-lg p-2.5 text-xs space-y-1.5 text-white">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Posisi Terakhir</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-violet-500 inline-block" /> Titik Sebelumnya</div>
          <div className="flex items-center gap-2"><div className="w-6 h-0.5 bg-violet-400" /> Trail GPS</div>
          <div className="text-[9px] text-gray-400 mt-1">© Esri · MapLibre GL (Open Source)</div>
        </div>

        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-cardBg">
            <div className="text-center space-y-2">
              <Loader2 className="animate-spin text-accentViolet mx-auto" size={32} />
              <p className="text-xs text-textSecondary">Memuat peta (MapLibre GL)...</p>
            </div>
          </div>
        )}
        {gpsLogs.length === 0 && mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="text-center space-y-2 glass-card rounded-2xl p-6">
              <MapPin size={28} className="text-textSecondary mx-auto" />
              <p className="text-sm text-textSecondary">Belum ada data GPS untuk periode ini.</p>
            </div>
          </div>
        )}
      </div>

      {/* GPS list + WiFi history */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-5">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-accentViolet" /> Riwayat {gpsLogs.length} Titik GPS
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {gpsLogs.slice(0, 50).map((log, i) => (
              <div key={log.id} onClick={() => {
                const map = mapRef.current;
                if (map) map.flyTo({ center: [log.longitude, log.latitude], zoom: 16 });
              }} className="flex items-center justify-between py-2 border-b border-borderDark/30 last:border-0 hover:bg-accentViolet/5 cursor-pointer rounded px-1 transition-colors">
                <div className="flex items-center gap-2">
                  {i === 0 ? <span className="w-2 h-2 rounded-full bg-green-500" /> : <span className="w-2 h-2 rounded-full bg-violet-500/60" />}
                  <span className="text-xs text-textPrimary font-mono">{log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}</span>
                </div>
                <span className="text-[10px] text-textSecondary">{timeAgo(log.recorded_at)}</span>
              </div>
            ))}
            {gpsLogs.length === 0 && <p className="text-xs text-textSecondary text-center py-4">Belum ada data GPS.</p>}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
            <Wifi size={16} className="text-accentBlue" /> Riwayat WiFi ({wifiGroups.length} jaringan)
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {wifiGroups.map((g, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-borderDark/30 last:border-0">
                <div>
                  <p className="text-xs font-semibold text-textPrimary">{g.ssid}</p>
                  <p className="text-[10px] text-textSecondary font-mono">{g.bssid}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accentBlue/10 text-accentBlue">{g.count}x</span>
                  <p className="text-[10px] text-textSecondary mt-1">{timeAgo(g.lastSeen)}</p>
                </div>
              </div>
            ))}
            {wifiGroups.length === 0 && <p className="text-xs text-textSecondary text-center py-4">Belum ada riwayat WiFi.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
