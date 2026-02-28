import React, { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('impersonating')); } catch { return null; }
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    getMe()
      .then(res => setUser(res.data.user))
      .catch(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    // Se si sta impersonando, torna all'admin
    if (impersonating) {
      stopImpersonating();
      return;
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const impersonate = (token, userData, adminData) => {
    // Salva sessione admin
    const adminSession = {
      token: localStorage.getItem('token'),
      user: JSON.parse(localStorage.getItem('user')),
      adminUser: adminData,
    };
    sessionStorage.setItem('impersonating', JSON.stringify(adminSession));
    setImpersonating(adminSession);

    // Sostituisci con sessione utente
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const stopImpersonating = () => {
    const saved = impersonating || JSON.parse(sessionStorage.getItem('impersonating'));
    if (!saved) return;

    localStorage.setItem('token', saved.token);
    localStorage.setItem('user', JSON.stringify(saved.user));
    setUser(saved.user);
    sessionStorage.removeItem('impersonating');
    setImpersonating(null);
  };

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout,
      isAdmin: user?.role === 'admin' && !impersonating,
      impersonating,
      impersonate,
      stopImpersonating,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
