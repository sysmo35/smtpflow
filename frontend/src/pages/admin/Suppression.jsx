import React, { useEffect, useState } from 'react';
import { getSuppressionList, addSuppression, removeSuppression } from '../../api';
import { ShieldOff, Trash2, Plus, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Suppression() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  const load = async (p = page, s = search) => {
    setLoading(true);
    try {
      const res = await getSuppressionList({ page: p, limit, search: s });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch {
      toast.error('Errore nel caricamento');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load(1, search);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await addSuppression({ email: newEmail.trim() });
      toast.success('Email aggiunta alla suppression list');
      setNewEmail('');
      load(1, search);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (email) => {
    if (!confirm(`Rimuovere ${email} dalla suppression list?`)) return;
    try {
      await removeSuppression(email);
      setItems(prev => prev.filter(i => i.email !== email));
      setTotal(t => t - 1);
      toast.success('Rimosso dalla suppression list');
    } catch {
      toast.error('Errore nella rimozione');
    }
  };

  const reasonBadge = (reason) => {
    const map = {
      hard_bounce: { label: 'Hard bounce', cls: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400' },
      spam: { label: 'Spam', cls: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400' },
      manual: { label: 'Manuale', cls: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400' },
    };
    const r = map[reason] || map.manual;
    return <span className={`badge border text-xs ${r.cls}`}>{r.label}</span>;
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Suppression List</h1>
        <p className="text-slate-500 text-sm mt-1">
          Indirizzi bloccati — le email a questi destinatari vengono rifiutate prima dell'invio
        </p>
      </div>

      {/* Add email */}
      <div className="card">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Plus size={16} className="text-brand-500" /> Aggiungi manualmente
        </h3>
        <form onSubmit={handleAdd} className="flex gap-3">
          <input
            type="email"
            className="input flex-1"
            placeholder="email@esempio.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
          />
          <button type="submit" disabled={adding || !newEmail.trim()} className="btn-primary flex items-center gap-2">
            {adding ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
            Aggiungi
          </button>
        </form>
      </div>

      {/* Search + list */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                className="input pl-10"
                placeholder="Cerca email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-secondary">Cerca</button>
          </form>
          <button onClick={() => load()} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-lg">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <span className="text-sm text-slate-500">{total} totali</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <ShieldOff size={36} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-slate-500">Nessun indirizzo in suppression list</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Email</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Motivo</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Messaggio</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Data</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-slate-800 dark:text-slate-200">{item.email}</td>
                  <td className="px-4 py-3">{reasonBadge(item.reason)}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate" title={item.bounce_message}>{item.bounce_message || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(item.created_at).toLocaleDateString('it-IT')}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleRemove(item.email)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > limit && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-slate-200 dark:border-slate-700/50">
            <button disabled={page === 1} onClick={() => { setPage(p => p - 1); load(page - 1); }} className="btn-secondary text-xs py-1.5 px-3">Precedente</button>
            <span className="text-sm text-slate-500">Pagina {page}</span>
            <button disabled={page * limit >= total} onClick={() => { setPage(p => p + 1); load(page + 1); }} className="btn-secondary text-xs py-1.5 px-3">Successiva</button>
          </div>
        )}
      </div>
    </div>
  );
}
