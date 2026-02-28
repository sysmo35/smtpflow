import React, { useEffect, useState } from 'react';
import { getPackages, createPackage, updatePackage, deletePackage } from '../../api';
import { Plus, Edit2, Trash2, X, Check, Package, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

function PackageModal({ pkg, onClose, onSave }) {
  const isEdit = !!pkg?.id;
  const [form, setForm] = useState(pkg?.id ? {
    name: pkg.name, description: pkg.description || '',
    monthly_limit: pkg.monthly_limit, daily_limit: pkg.daily_limit || '',
    price: pkg.price, is_active: pkg.is_active,
    features: (pkg.features || []).join('\n'),
  } : {
    name: '', description: '', monthly_limit: 1000, daily_limit: '',
    price: 0, is_active: true, features: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      ...form,
      monthly_limit: parseInt(form.monthly_limit),
      daily_limit: form.daily_limit ? parseInt(form.daily_limit) : null,
      price: parseFloat(form.price),
      features: form.features.split('\n').map(f => f.trim()).filter(Boolean),
    };
    try {
      if (isEdit) {
        const res = await updatePackage(pkg.id, payload);
        onSave(res.data);
        toast.success('Pacchetto aggiornato');
      } else {
        const res = await createPackage(payload);
        onSave(res.data, true);
        toast.success('Pacchetto creato');
      }
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100">{isEdit ? 'Modifica Pacchetto' : 'Nuovo Pacchetto'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Nome pacchetto</label>
              <input type="text" className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Starter" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Prezzo (€/mese)</label>
              <input type="number" step="0.01" min="0" className="input" required value={form.price} onChange={e => setForm({...form, price: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Descrizione</label>
            <input type="text" className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Breve descrizione..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Limite mensile (email)</label>
              <input type="number" min="1" className="input" required value={form.monthly_limit} onChange={e => setForm({...form, monthly_limit: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Limite giornaliero (opz.)</label>
              <input type="number" min="1" className="input" value={form.daily_limit} onChange={e => setForm({...form, daily_limit: e.target.value})} placeholder="illimitato" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Features (una per riga)</label>
            <textarea
              className="input min-h-24 resize-none"
              value={form.features}
              onChange={e => setForm({...form, features: e.target.value})}
              placeholder="10,000 email/mese&#10;Tracking completo&#10;API access"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded accent-brand-500"
                checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} />
              <span className="text-sm text-slate-700 dark:text-slate-300">Pacchetto attivo</span>
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annulla</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" /> : isEdit ? 'Salva' : 'Crea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminPackages() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    getPackages()
      .then(res => setPackages(res.data))
      .catch(() => toast.error('Errore caricamento'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id, name) => {
    if (!confirm(`Eliminare il pacchetto "${name}"?`)) return;
    try {
      await deletePackage(id);
      setPackages(prev => prev.filter(p => p.id !== id));
      toast.success('Pacchetto eliminato');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    }
  };

  const handleSave = (updated, isNew = false) => {
    if (isNew) {
      setPackages(prev => [...prev, updated]);
    } else {
      setPackages(prev => prev.map(p => p.id === updated.id ? updated : p));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Pacchetti</h1>
          <p className="text-slate-500 text-sm mt-1">Gestisci i piani di abbonamento</p>
        </div>
        <button onClick={() => setModal('create')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuovo pacchetto
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {packages.map(pkg => (
            <div key={pkg.id} className={`card relative flex flex-col ${!pkg.is_active ? 'opacity-60' : ''}`}>
              {!pkg.is_active && (
                <div className="absolute top-3 right-3">
                  <span className="badge bg-slate-200/50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-600 text-xs">Disattivo</span>
                </div>
              )}

              <div className="flex items-start gap-3 mb-4">
                <div className="p-2.5 bg-brand-500/10 rounded-xl">
                  <Package size={18} className="text-brand-500 dark:text-brand-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">{pkg.name}</h3>
                  <p className="text-xs text-slate-500">{pkg.description}</p>
                </div>
              </div>

              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                €{parseFloat(pkg.price).toFixed(2)}
                <span className="text-sm font-normal text-slate-500">/mese</span>
              </div>

              <div className="flex items-center gap-4 my-3 py-3 border-y border-slate-200 dark:border-slate-700/50 text-sm">
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Zap size={14} className="text-brand-500 dark:text-brand-400" />
                  {pkg.monthly_limit.toLocaleString()} email/mese
                </div>
                {pkg.user_count > 0 && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Users size={14} />
                    {pkg.user_count} utenti
                  </div>
                )}
              </div>

              {Array.isArray(pkg.features) && pkg.features.length > 0 && (
                <ul className="space-y-1.5 flex-1 mb-4">
                  {pkg.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <Check size={12} className="text-brand-500 dark:text-brand-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2 mt-auto pt-3">
                <button onClick={() => setModal(pkg)} className="btn-secondary flex-1 flex items-center justify-center gap-1.5 text-sm py-2">
                  <Edit2 size={14} /> Modifica
                </button>
                <button onClick={() => handleDelete(pkg.id, pkg.name)} className="btn-danger flex items-center gap-1.5 text-sm py-2 px-3">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PackageModal
          pkg={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
