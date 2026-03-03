import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api';
import toast from 'react-hot-toast';
import { Zap, Lock, Eye, EyeOff } from 'lucide-react';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-surface-900 flex items-center justify-center p-4">
        <div className="card text-center max-w-sm">
          <p className="text-slate-600 dark:text-slate-400">Link non valido.</p>
          <Link to="/login" className="btn-primary mt-4 inline-block">Torna al login</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error('Le password non coincidono');
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ token, password: form.password });
      toast.success('Password aggiornata!');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Token non valido o scaduto');
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Nuova password</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">Scegli una nuova password per il tuo account</p>
        </div>

        <div className="card shadow-2xl shadow-black/10 dark:shadow-black/50">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Nuova password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input pl-10 pr-10"
                  placeholder="Minimo 8 caratteri"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  minLength={8}
                  required
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Conferma password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input pl-10"
                  placeholder="Ripeti la password"
                  value={form.confirm}
                  onChange={e => setForm({ ...form, confirm: e.target.value })}
                  required
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Salvataggio...
                </span>
              ) : 'Imposta nuova password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
