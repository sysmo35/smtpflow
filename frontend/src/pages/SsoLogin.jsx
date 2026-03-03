import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ssoValidate } from '../api';
import { Zap } from 'lucide-react';

export default function SsoLogin() {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Token SSO mancante.');
      return;
    }

    ssoValidate(token)
      .then(res => {
        login(res.data.token, res.data.user);
        navigate(res.data.user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
      })
      .catch(err => {
        setError(err.response?.data?.error || 'Token SSO non valido o scaduto.');
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Zap size={28} className="text-white" />
          </div>
        </div>

        {error ? (
          <>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Accesso non riuscito</h1>
            <p className="text-red-500 text-sm">{error}</p>
            <a
              href="/login"
              className="mt-6 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium"
            >
              Torna al login
            </a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Accesso in corso…</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Validazione token SSO</p>
            <div className="flex justify-center">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
