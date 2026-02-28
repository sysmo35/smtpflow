import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { getDashboard } from '../../api';
import { Mail, TrendingUp, AlertCircle, Eye, ChevronRight, Zap, BarChart2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTheme } from '../../contexts/ThemeContext';

function StatCard({ label, value, sub, icon: Icon, color = 'brand' }) {
  const colors = {
    brand: 'from-brand-500/20 to-brand-600/10 border-brand-500/20 text-brand-500 dark:text-brand-400',
    green: 'from-green-500/20 to-green-600/10 border-green-500/20 text-green-600 dark:text-green-400',
    red: 'from-red-500/20 to-red-600/10 border-red-500/20 text-red-600 dark:text-red-400',
    yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
  };
  return (
    <div className={`card bg-gradient-to-br ${colors[color]} border`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-xl bg-current/10 ${colors[color].split(' ').at(-1)}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  opened: '#22c55e',
  sent: '#6366f1',
  bounced: '#ef4444',
  spam: '#f97316',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-surface-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-xl text-xs">
      <p className="text-slate-500 mb-1">{label}</p>
      <p className="text-brand-600 dark:text-brand-400 font-semibold">{payload[0]?.value} email</p>
    </div>
  );
};

export default function UserDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { dark } = useTheme();

  useEffect(() => {
    getDashboard()
      .then(res => setData(res.data))
      .catch(() => toast.error('Errore nel caricamento'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!data) return null;

  const { stats, usage, recentEmails, trend, package: pkg } = data;

  const pieData = [
    { name: 'Aperte', value: stats.opened, color: '#22c55e' },
    { name: 'Inviate', value: Math.max(0, stats.sent - stats.opened - stats.bounced), color: '#6366f1' },
    { name: 'Bounce', value: stats.bounced, color: '#ef4444' },
    { name: 'Spam', value: stats.spam, color: '#f97316' },
  ].filter(d => d.value > 0);

  const trendData = trend?.map(t => ({
    date: new Date(t.date).toLocaleDateString('it', { day: '2-digit', month: 'short' }),
    count: parseInt(t.count),
  })) || [];

  const gridColor = dark ? '#1e293b' : '#e2e8f0';
  const tickColor = dark ? '#64748b' : '#94a3b8';
  const pieTooltipStyle = {
    background: dark ? '#1e293b' : '#ffffff',
    border: dark ? '1px solid #334155' : '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 12,
    color: dark ? '#f1f5f9' : '#0f172a',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Panoramica delle tue email degli ultimi 30 giorni</p>
      </div>

      {/* Usage bar */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Utilizzo mensile</p>
            <p className="text-xs text-slate-500 mt-0.5">{pkg?.name || 'Free'} · {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} email</p>
          </div>
          <span className={`badge ${usage.percentage > 90 ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' : usage.percentage > 70 ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'} border`}>
            {usage.percentage}%
          </span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-700/50 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${usage.percentage > 90 ? 'bg-red-500' : usage.percentage > 70 ? 'bg-yellow-500' : 'bg-gradient-to-r from-brand-500 to-purple-500'}`}
            style={{ width: `${Math.min(usage.percentage, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Inviate oggi" value={stats.today} icon={Zap} color="brand" />
        <StatCard label="Totale mese" value={stats.total.toLocaleString()} icon={Mail} color="blue" />
        <StatCard label="Tasso apertura" value={`${stats.openRate}%`} icon={Eye} color="green" />
        <StatCard label="Tasso bounce" value={`${stats.bounceRate}%`} icon={AlertCircle} color={parseFloat(stats.bounceRate) > 5 ? 'red' : 'yellow'} />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Trend chart */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Email inviate (30 giorni)</h3>
            <BarChart2 size={16} className="text-slate-400" />
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorEmail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#colorEmail)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
              Nessuna email inviata negli ultimi 30 giorni
            </div>
          )}
        </div>

        {/* Pie chart */}
        <div className="card">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4">Stato email</h3>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, name]} contentStyle={pieTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {pieData.map(item => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                      <span className="text-slate-500">{item.name}</span>
                    </div>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-32 flex items-center justify-center text-slate-500 text-sm">Nessun dato</div>
          )}
        </div>
      </div>

      {/* Recent emails */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">Email recenti</h3>
          <Link to="/history" className="text-xs text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 flex items-center gap-1 transition-colors">
            Vedi tutto <ChevronRight size={14} />
          </Link>
        </div>
        {recentEmails?.length > 0 ? (
          <div className="space-y-2">
            {recentEmails.map(email => (
              <div key={email.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900 transition-colors">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  email.opened ? 'bg-green-400' : email.bounced ? 'bg-red-400' : email.spam_reported ? 'bg-orange-400' : 'bg-brand-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 dark:text-slate-200 truncate font-medium">{email.subject || '(no subject)'}</p>
                  <p className="text-xs text-slate-500 truncate">{email.to_addresses}</p>
                </div>
                <div className="text-right shrink-0">
                  <StatusBadge email={email} />
                  <p className="text-xs text-slate-400 mt-1">{new Date(email.created_at).toLocaleDateString('it')}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500 text-sm">
            <Mail size={32} className="mx-auto mb-2 opacity-30" />
            <p>Nessuna email inviata ancora</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ email }) {
  if (email.spam_reported) return <span className="badge badge-spam">Spam</span>;
  if (email.bounced) return <span className="badge badge-bounced">Bounce</span>;
  if (email.opened) return <span className="badge badge-opened">Aperta</span>;
  return <span className="badge badge-sent">Inviata</span>;
}
