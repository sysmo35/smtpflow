import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api';
import toast from 'react-hot-toast';
import { Zap, Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword({ email });
      setSent(true);
    } catch {
      toast.error('Errore durante l\'invio');
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Password dimenticata</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            {sent ? 'Controlla la tua casella email' : 'Inserisci la tua email per ricevere il link di reset'}
          </p>
        </div>

        <div className="card shadow-2xl shadow-black/10 dark:shadow-black/50">
          {sent ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <Mail size={24} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                Se l'indirizzo è registrato, riceverai a breve un'email con le istruzioni per il reset.
              </p>
              <Link to="/login" className="btn-primary w-full flex items-center justify-center gap-2">
                <ArrowLeft size={16} /> Torna al login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    className="input pl-10"
                    placeholder="tua@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Invio in corso...
                  </span>
                ) : 'Invia link di reset'}
              </button>

              <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                <Link to="/login" className="text-brand-600 hover:text-brand-500 dark:text-brand-400 font-medium flex items-center justify-center gap-1">
                  <ArrowLeft size={14} /> Torna al login
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
