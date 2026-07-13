import React from 'react';

interface DeviceStatusPulseProps {
  lastHeartbeatAt: string; // ISO String format
}

export default function DeviceStatusPulse({ lastHeartbeatAt }: DeviceStatusPulseProps) {
  const getStatus = () => {
    if (!lastHeartbeatAt) return { color: 'bg-gray-500', text: 'Menunggu' };
    const diffMinutes = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60000;
    if (diffMinutes < 5)   return { color: 'bg-accentGreen shadow-[0_0_8px_rgba(16,185,129,0.6)]', text: 'Online'      };
    if (diffMinutes < 60)  return { color: 'bg-accentYellow',                                       text: 'Terputus'    };
    if (diffMinutes < 360) return { color: 'bg-accentRed',                                          text: 'Offline'     };
    return                        { color: 'bg-gray-600',                                           text: 'Tidak Aktif' };
  };

  const status = getStatus();

  return (
    <div className="flex items-center gap-2">
      <span className={`w-3.5 h-3.5 rounded-full ${status.color}`} />
      <span className="text-sm font-medium text-textSecondary">{status.text}</span>
    </div>
  );
}
