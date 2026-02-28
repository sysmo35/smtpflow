import React, { useEffect, useState, useCallback } from 'react';
import { getAdminUsers, createUser, updateUser, deleteUser, resetUserSmtp, resetUserPassword, getPackages, impersonateUser } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit2, Trash2, RefreshCw, X, ChevronLeft, ChevronRight, LogIn, Key, Copy, Check, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = ['active', 'suspended'];
const ROLE_FILTER_OPTIONS = [
  { value: '', label: 'Tutti' },
  { value: 'user', label: 'Utenti' },
  { value: 'admin', label: 'Admin' },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handle} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors">
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

function PasswordResetModal({ user, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [customPwd, setCustomPwd] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  const handleReset = async () => {
    setLoading(true);
    try {
      const res = await resetUserPassword(user.id, useCustom ? customPwd : undefined);
      setResult(res.data);
      toast.success('Password reimpostata');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Reset Password — {user.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
        </div>

        {!result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="useCustom"
                checked={useCustom}
                onChange={e => setUseCustom(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="useCustom" className="text-sm text-slate-600 dark:text-slate-300">Specifica password manualmente</label>
            </div>
            {useCustom && (
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Nuova password (min. 8 caratteri)</label>
                <input
                  type="password"
                  className="input"
                  minLength={8}
                  value={customPwd}
                  onChange={e => setCustomPwd(e.target.value)}
                  placeholder="Inserisci la nuova password"
                />
              </div>
            )}
            <p className="text-xs text-slate-500">
              {useCustom ? 'Verrà impostata la password specificata.' : 'Verrà generata una password casuale sicura.'}
            </p>
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="btn-secondary flex-1">Annulla</button>
              <button
                onClick={handleReset}
                disabled={loading || (useCustom && customPwd.length < 8)}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><Key size={14} /> Reset Password</>
                }
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mb-2">Password reimpostata con successo</p>
              <p className="text-xs text-slate-500 mb-3">Condividi questa password con l'utente. Non verrà mostrata di nuovo.</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-600">
                  <span className="text-xs text-slate-500 mr-2">Email:</span>
                  <span className="font-mono text-sm text-slate-800 dark:text-slate-200 flex-1">{result.email}</span>
                  <CopyButton text={result.email} />
                </div>
                <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-600">
                  <span className="text-xs text-slate-500 mr-2">Password:</span>
                  <span className="font-mono text-sm text-slate-800 dark:text-slate-200 flex-1 break-all">{result.newPassword}</span>
                  <CopyButton text={result.newPassword} />
                </div>
              </div>
            </div>
            <button onClick={onClose} className="btn-secondary w-full">Chiudi</button>
          </div>
        )}
      </div>
    </div>
  );
}

function UserModal({ user, packages, onClose, onSave }) {
  const isEdit = !!user?.id;
  const [form, setForm] = useState(
    user?.id ? { name: user.name, status: user.status, package_id: user.package_id, role: user.role }
             : { name: '', email: '', password: '', role: 'user', package_id: '' }
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEdit) {
        const res = await updateUser(user.id, form);
        onSave(res.data);
        toast.success('Utente aggiornato');
      } else {
        const res = await createUser(form);
        onSave(res.data);
        toast.success('Utente creato');
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
      <div className="card max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100">{isEdit ? 'Modifica Utente' : 'Crea Utente'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Email</label>
                <input type="email" className="input" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Password (min. 8 caratteri)</label>
                <input type="password" className="input" required minLength={8} value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Nome</label>
            <input type="text" className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Ruolo</label>
              <select className="input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Status</label>
                <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>
          {form.role !== 'admin' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Pacchetto</label>
              <select className="input" value={form.package_id || ''} onChange={e => setForm({...form, package_id: e.target.value || null})}>
                <option value="">-- Nessun pacchetto --</option>
                {packages.map(p => <option key={p.id} value={p.id}>{p.name} ({p.monthly_limit.toLocaleString()} email/mese)</option>)}
              </select>
            </div>
          )}
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

export default function AdminUsers() {
  const { impersonate, user: adminUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [modal, setModal] = useState(null);
  const [pwdModal, setPwdModal] = useState(null);
  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, pkgRes] = await Promise.all([
        getAdminUsers({ page, limit, search, role: roleFilter }),
        packages.length === 0 ? getPackages() : Promise.resolve(null),
      ]);
      setUsers(usersRes.data.users);
      setTotal(usersRes.data.total);
      if (pkgRes) setPackages(pkgRes.data);
    } catch {
      toast.error('Errore caricamento');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDelete = async (id, name) => {
    if (!confirm(`Eliminare l'utente ${name}?`)) return;
    try {
      await deleteUser(id);
      setUsers(prev => prev.filter(u => u.id !== id));
      toast.success('Utente eliminato');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    }
  };

  const handleResetSmtp = async (id) => {
    try {
      await resetUserSmtp(id);
      toast.success('Password SMTP reimpostata');
    } catch {
      toast.error('Errore reset SMTP');
    }
  };

  const handleImpersonate = async (user) => {
    try {
      const res = await impersonateUser(user.id);
      impersonate(res.data.token, res.data.user, { id: adminUser.id, email: adminUser.email, name: adminUser.name });
      navigate('/dashboard');
      toast.success(`Stai visualizzando come ${user.name}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore impersonificazione');
    }
  };

  const handleSave = (updated) => {
    setUsers(prev => {
      const idx = prev.findIndex(u => u.id === updated.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...prev[idx], ...updated }; return next; }
      return [updated, ...prev];
    });
  };

  const pages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Utenti</h1>
          <p className="text-slate-500 text-sm mt-1">{total} utenti trovati</p>
        </div>
        <button onClick={() => setModal('create')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuovo utente
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input type="text" className="input pl-10" placeholder="Cerca per nome o email..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
          {ROLE_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setRoleFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                roleFilter === opt.value
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-slate-500">Nessun utente trovato</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700/50">
                    {['Utente', 'Ruolo', 'Pacchetto', 'Email questo mese', 'Status', 'Registrato', 'Azioni'].map(h => (
                      <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/30">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/10 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm border shrink-0 ${
                            user.role === 'admin'
                              ? 'bg-gradient-to-br from-amber-500/20 to-orange-600/20 text-amber-600 dark:text-amber-300 border-amber-500/20'
                              : 'bg-gradient-to-br from-brand-500/20 to-purple-600/20 text-brand-600 dark:text-brand-300 border-brand-500/10'
                          }`}>
                            {user.role === 'admin' ? <Shield size={14} /> : user.name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-200">{user.name}</p>
                            <p className="text-xs text-slate-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                          user.role === 'admin'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
                            : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700/30 dark:text-slate-400 dark:border-slate-600/30'
                        }`}>
                          {user.role === 'admin' && <Shield size={10} />}
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-slate-600 dark:text-slate-300 text-xs">{user.package_name || '—'}</span>
                        {user.monthly_limit && <p className="text-xs text-slate-400">{user.monthly_limit.toLocaleString()} email/mese</p>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-slate-700 dark:text-slate-300">{parseInt(user.emails_this_month).toLocaleString()}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`badge border ${user.status === 'active' ? 'badge-active' : 'badge-suspended'}`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(user.created_at).toLocaleDateString('it')}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1">
                          {user.role !== 'admin' && (
                            <button onClick={() => handleImpersonate(user)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:text-slate-500 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 rounded-lg transition-colors" title="Accedi come utente"><LogIn size={14} /></button>
                          )}
                          <button onClick={() => setModal(user)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:text-slate-500 dark:hover:text-brand-400 dark:hover:bg-brand-500/10 rounded-lg transition-colors" title="Modifica"><Edit2 size={14} /></button>
                          <button onClick={() => setPwdModal(user)} className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:text-slate-500 dark:hover:text-violet-400 dark:hover:bg-violet-500/10 rounded-lg transition-colors" title="Reset Password Login"><Key size={14} /></button>
                          {user.role !== 'admin' && (
                            <button onClick={() => handleResetSmtp(user.id)} className="p-1.5 text-slate-400 hover:text-yellow-600 hover:bg-yellow-50 dark:text-slate-500 dark:hover:text-yellow-400 dark:hover:bg-yellow-500/10 rounded-lg transition-colors" title="Reset SMTP"><RefreshCw size={14} /></button>
                          )}
                          <button onClick={() => handleDelete(user.id, user.name)} disabled={user.id === adminUser?.id} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:text-slate-500 dark:hover:text-red-400 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Elimina"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 dark:border-slate-700/50">
                <span className="text-xs text-slate-500">Pagina {page} di {pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
                  <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <UserModal
          user={modal === 'create' ? null : modal}
          packages={packages}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {pwdModal && (
        <PasswordResetModal
          user={pwdModal}
          onClose={() => setPwdModal(null)}
        />
      )}
    </div>
  );
}
