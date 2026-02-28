import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

import Login from './pages/Login';
import Register from './pages/Register';
import Layout from './components/Layout';

// Admin pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminPackages from './pages/admin/Packages';
import AdminBranding from './pages/admin/Branding';

// User pages
import UserDashboard from './pages/user/Dashboard';
import UserHistory from './pages/user/History';
import UserCredentials from './pages/user/Credentials';
import UserDomains from './pages/user/Domains';

function ThemedToaster() {
  const { dark } = useTheme();
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: dark ? '#1e293b' : '#ffffff',
          color: dark ? '#f1f5f9' : '#0f172a',
          border: dark ? '1px solid #334155' : '1px solid #e2e8f0',
          borderRadius: '12px',
          fontSize: '14px',
        },
        success: { iconTheme: { primary: '#22c55e', secondary: dark ? '#1e293b' : '#ffffff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: dark ? '#1e293b' : '#ffffff' } },
      }}
    />
  );
}

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-slate-50 dark:bg-surface-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Register />} />

      {/* Admin routes */}
      <Route path="/admin" element={<ProtectedRoute adminOnly><Layout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="packages" element={<AdminPackages />} />
        <Route path="branding" element={<AdminBranding />} />
      </Route>

      {/* User routes */}
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="dashboard" element={<UserDashboard />} />
        <Route path="history" element={<UserHistory />} />
        <Route path="credentials" element={<UserCredentials />} />
        <Route path="domains" element={<UserDomains />} />
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrandingProvider>
          <AppRoutes />
          <ThemedToaster />
        </BrandingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
