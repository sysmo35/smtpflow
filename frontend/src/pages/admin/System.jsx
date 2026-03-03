import React, { useEffect, useState, useCallback } from 'react';
import { getSystemStats } from '../../api';
import { Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react';

function fmt(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}g`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function Gauge({ label, percent, used, total, icon: Icon, color }) {
  const c = {
    green: 'text-green-500 bg-green-500',
    yellow: 'text-yellow-500 bg-yellow-500',
    red: 'text-red-500 bg-red-500',
    blue: 'text-blue-500 bg-blue-500',
  }[percent > 85 ? 'red' : percent > 60 ? 'yellow' : color];

  const [textColor, barColor] = c.split(' ');

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800`}>
            <Icon size={20} className={textColor} />
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{label}</div>
            {total > 0 && (
              <div className="text-xs text-slate-500">{fmt(used)} / {fmt(total)}</div>
            )}
          </div>
        </div>
        <div className={`text-3xl font-bold tabular-nums ${textColor}`}>{percent}%</div>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function System() {
  const [stats, setStats] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getSystemStats();
      setStats(res.data);
      setLastUpdate(new Date());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Sistema</h1>
          <p className="text-slate-500 text-sm mt-1">Monitoraggio risorse in tempo reale (aggiornamento ogni 5s)</p>
        </div>
        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            {lastUpdate.toLocaleTimeString('it-IT')}
          </div>
        )}
      </div>

      {!stats ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Gauge
              label="CPU"
              percent={stats.cpu.percent}
              used={0} total={0}
              icon={Cpu}
              color="blue"
            />
            <Gauge
              label="RAM"
              percent={stats.ram.percent}
              used={stats.ram.used}
              total={stats.ram.total}
              icon={MemoryStick}
              color="green"
            />
            <Gauge
              label="Disco"
              percent={stats.disk.percent}
              used={stats.disk.used}
              total={stats.disk.total}
              icon={HardDrive}
              color="green"
            />
            <div className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800">
                <Clock size={20} className="text-purple-500" />
              </div>
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">Uptime</div>
                <div className="text-2xl font-bold text-purple-500 tabular-nums">{fmtUptime(stats.uptime)}</div>
              </div>
            </div>
          </div>

          <div className="card text-xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>CPU — load average (1m)</span>
              <span className="font-mono">{stats.cpu.load1} ({stats.cpu.cores} core)</span>
            </div>
            <div className="flex justify-between">
              <span>RAM libera</span>
              <span className="font-mono">{fmt(stats.ram.free)}</span>
            </div>
            <div className="flex justify-between">
              <span>Disco libero</span>
              <span className="font-mono">{fmt(stats.disk.free)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
