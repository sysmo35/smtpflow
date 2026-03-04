import React, { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [workspace, setWorkspace] = useState(() => {
    try { return JSON.parse(localStorage.getItem('workspace')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('impersonating')); } catch { return null; }
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    getMe()
      .then(res => {
        setUser(res.data.user);
        if (res.data.workspace) {
          setWorkspace(res.data.workspace);
          localStorage.setItem('workspace', JSON.stringify(res.data.workspace));
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('workspace');
        setUser(null);
        setWorkspace(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = (token, userData, workspaceData = null) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    if (workspaceData) {
      localStorage.setItem('workspace', JSON.stringify(workspaceData));
      setWorkspace(workspaceData);
    } else {
      localStorage.removeItem('workspace');
      setWorkspace(null);
    }
  };

  const switchWorkspace = (token, workspaceData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('workspace', JSON.stringify(workspaceData));
    setWorkspace(workspaceData);
  };

  const updateWorkspaceName = (name) => {
    const updated = { ...workspace, name };
    localStorage.setItem('workspace', JSON.stringify(updated));
    setWorkspace(updated);
  };

  const logout = () => {
    if (impersonating) {
      stopImpersonating();
      return;
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('workspace');
    setUser(null);
    setWorkspace(null);
  };

  const impersonate = (token, userData, adminData, workspaceData = null) => {
    const adminSession = {
      token: localStorage.getItem('token'),
      user: JSON.parse(localStorage.getItem('user')),
      workspace: JSON.parse(localStorage.getItem('workspace')),
      adminUser: adminData,
    };
    sessionStorage.setItem('impersonating', JSON.stringify(adminSession));
    setImpersonating(adminSession);

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    if (workspaceData) {
      localStorage.setItem('workspace', JSON.stringify(workspaceData));
      setWorkspace(workspaceData);
    }
  };

  const stopImpersonating = () => {
    const saved = impersonating || JSON.parse(sessionStorage.getItem('impersonating'));
    if (!saved) return;

    localStorage.setItem('token', saved.token);
    localStorage.setItem('user', JSON.stringify(saved.user));
    setUser(saved.user);
    if (saved.workspace) {
      localStorage.setItem('workspace', JSON.stringify(saved.workspace));
      setWorkspace(saved.workspace);
    } else {
      localStorage.removeItem('workspace');
      setWorkspace(null);
    }
    sessionStorage.removeItem('impersonating');
    setImpersonating(null);
  };

  return (
    <AuthContext.Provider value={{
      user, workspace, loading, login, logout, switchWorkspace, updateWorkspaceName,
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
