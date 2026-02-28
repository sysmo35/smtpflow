import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { register as registerApi } from '../api';
import toast from 'react-hot-toast';
import { Zap, Mail, Lock, User } from 'lucide-react';

export default function Register() {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return toast.error('Password di almeno 8 caratteri');
    setLoading(true);
    try {
      const res = await registerApi(form);
      login(res.data.token, res.data.user);
      toast.success('Account creato con successo!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore durante la registrazione');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-surface-900 flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-brand-500 to-purple-600 rounded-2xl shadow-lg shadow-brand-500/30 mb-4">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Crea account</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">Inizia a inviare email professionali</p>
        </div>

        <div className="card shadow-2xl shadow-black/10 dark:shadow-black/50">
          {/* Features preview */}
          <div className="bg-gradient-to-r from-brand-600/10 to-purple-600/10 rounded-xl p-4 mb-6 border border-brand-500/10">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-2">INCLUSO NEL PIANO GRATUITO</p>
            <div className="grid grid-cols-2 gap-1.5">
              {['1.000 email/mese', 'Tracking aperture', 'Statistiche base', '1 Dominio personalizzato'].map(f => (
                <div key={f} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="w-1.5 h-1.5 bg-brand-400 rounded-full shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Nome completo</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="Mario Rossi"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required minLength={2}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="email"
                  className="input pl-10"
                  placeholder="tua@email.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="password"
                  className="input pl-10"
                  placeholder="Minimo 8 caratteri"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required minLength={8}
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creazione account...
                </span>
              ) : 'Crea Account Gratuito'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-5">
            Hai già un account?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300 font-medium">Accedi</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
