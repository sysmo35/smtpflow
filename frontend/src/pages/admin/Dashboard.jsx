import React, { useEffect, useState } from 'react';
import { getAdminStats } from '../../api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { Users, Mail, Package, TrendingUp, Eye, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTheme } from '../../contexts/ThemeContext';

function StatCard({ label, value, sub, icon: Icon, gradient }) {
  return (
    <div className={`card bg-gradient-to-br ${gradient} border relative overflow-hidden`}>
      <div className="absolute -right-4 -top-4 opacity-10">
        <Icon size={80} />
      </div>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-surface-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-xl text-xs">
      <p className="text-slate-500 mb-1">{label}</p>
      <p className="text-brand-600 dark:text-brand-400 font-semibold">{payload[0]?.value} email</p>
    </div>
  );
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { dark } = useTheme();

  useEffect(() => {
    getAdminStats()
      .then(res => setStats(res.data))
      .catch(() => toast.error('Errore nel caricamento'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!stats) return null;

  const trendData = (stats.trend || []).map(t => ({
    date: new Date(t.date).toLocaleDateString('it', { day: '2-digit', month: 'short' }),
    count: parseInt(t.count),
  }));

  const gridColor = dark ? '#1e293b' : '#e2e8f0';
  const tickColor = dark ? '#64748b' : '#94a3b8';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Admin Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Panoramica generale del sistema</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Utenti totali"
          value={stats.users.total.toLocaleString()}
          sub={`${stats.users.active} attivi`}
          icon={Users}
          gradient="from-brand-500/15 to-brand-600/5 border-brand-500/20"
        />
        <StatCard
          label="Email questo mese"
          value={stats.emails.thisMonth.toLocaleString()}
          sub={`${stats.emails.today} oggi`}
          icon={Mail}
          gradient="from-blue-500/15 to-blue-600/5 border-blue-500/20"
        />
        <StatCard
          label="Tasso apertura"
          value={`${stats.openRate}%`}
          sub="Ultimi 30 giorni"
          icon={Eye}
          gradient="from-green-500/15 to-green-600/5 border-green-500/20"
        />
        <StatCard
          label="Tasso bounce"
          value={`${stats.bounceRate}%`}
          sub="Ultimi 30 giorni"
          icon={AlertCircle}
          gradient={parseFloat(stats.bounceRate) > 5 ? 'from-red-500/15 to-red-600/5 border-red-500/20' : 'from-yellow-500/15 to-yellow-600/5 border-yellow-500/20'}
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4">Volume email (30 giorni)</h3>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="adminGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#adminGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-500 text-sm">Nessun dato disponibile</div>
          )}
        </div>

        {/* Top senders */}
        <div className="card">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-500 dark:text-brand-400" />
            Top mittenti
          </h3>
          {stats.topSenders?.length > 0 ? (
            <div className="space-y-3">
              {stats.topSenders.map((s, i) => (
                <div key={s.email} className="flex items-center gap-3">
                  <span className="w-5 h-5 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-xs text-slate-500 font-medium shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200 truncate font-medium">{s.name}</p>
                    <p className="text-xs text-slate-500 truncate">{s.email}</p>
                  </div>
                  <span className="text-sm font-semibold text-brand-600 dark:text-brand-400 shrink-0">{parseInt(s.sent).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-sm">Nessun dato</div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-brand-500/10 rounded-xl">
            <Package size={20} className="text-brand-500 dark:text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Pacchetti attivi</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.packages}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-green-500/10 rounded-xl">
            <Users size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Utenti attivi</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.users.active}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl">
            <Mail size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Email totali</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.emails.total.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
