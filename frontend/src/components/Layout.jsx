import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  LayoutDashboard, Users, Package, Mail, Key, Globe,
  LogOut, Menu, X, Activity, Zap, Palette, ArrowLeftCircle,
  Sun, Moon,
} from 'lucide-react';

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Utenti', icon: Users },
  { to: '/admin/packages', label: 'Pacchetti', icon: Package },
  { to: '/admin/branding', label: 'Branding', icon: Palette },
];

const userNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'Email Inviate', icon: Mail },
  { to: '/credentials', label: 'Credenziali SMTP', icon: Key },
  { to: '/domains', label: 'Domini', icon: Globe },
];

function NavItem({ to, label, icon: Icon, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
          isActive
            ? 'bg-brand-600/20 text-brand-600 border border-brand-500/20 dark:text-brand-400'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50'
        }`
      }
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout, isAdmin, impersonating, stopImpersonating } = useAuth();
  const { branding } = useBranding();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const nav = isAdmin ? adminNav : userNav;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const Sidebar = ({ mobile = false }) => (
    <div className={`flex flex-col h-full ${mobile ? '' : 'w-64'}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200 dark:border-slate-700/50">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shrink-0 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.secondary_color})` }}
        >
          {branding.logo_url
            ? <img src={branding.logo_url} alt="logo" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
            : <Zap size={18} className="text-white" />
          }
        </div>
        <div>
          <span className="font-bold text-slate-900 dark:text-slate-100 text-lg">{branding.app_name}</span>
          <div className="text-xs text-slate-500 -mt-0.5">{isAdmin ? 'Admin Panel' : 'User Panel'}</div>
        </div>
        {mobile && (
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {nav.map(item => (
          <NavItem key={item.to} {...item} onClick={() => mobile && setSidebarOpen(false)} />
        ))}
      </nav>

      {/* User info */}
      <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700/50 pt-4">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/50">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500/40 to-purple-600/40 flex items-center justify-center text-brand-600 dark:text-brand-300 font-semibold text-sm border border-brand-500/20">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{user?.name}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          </div>
          <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors" title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-surface-900 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white dark:bg-surface-800 border-r border-slate-200 dark:border-slate-700/50 shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex flex-col w-72 bg-white dark:bg-surface-800 border-r border-slate-200 dark:border-slate-700/50">
            <Sidebar mobile />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Impersonation banner */}
        {impersonating && (
          <div className="shrink-0 bg-amber-500/15 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm">
              <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              <span className="text-amber-700 dark:text-amber-200">
                Stai visualizzando come <strong className="text-amber-800 dark:text-amber-100">{user?.name}</strong>
                <span className="text-amber-500 ml-1">({user?.email})</span>
              </span>
            </div>
            <button
              onClick={stopImpersonating}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 px-3 py-1.5 rounded-lg transition-all shrink-0"
            >
              <ArrowLeftCircle size={14} />
              Torna all'admin
            </button>
          </div>
        )}
        {/* Top bar */}
        <header className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-surface-800/50 backdrop-blur shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Activity size={14} className="text-green-500" />
            <span className="text-green-600 dark:text-green-400 text-xs font-medium">Sistema Operativo</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-slate-500">Online</span>
            </div>
            <button
              onClick={toggle}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50 transition-all"
              title={dark ? 'Passa alla modalità chiara' : 'Passa alla modalità scura'}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
