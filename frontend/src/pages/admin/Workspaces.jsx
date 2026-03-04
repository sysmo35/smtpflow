import React, { useEffect, useState, useCallback } from 'react';
import { getAdminWorkspaces, updateAdminWorkspace, resetWorkspaceSmtp, deleteAdminWorkspace, getPackages } from '../../api';
import { Search, Edit2, Trash2, RefreshCw, X, Copy, Check, Layers } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = ['active', 'suspended', 'pending'];

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

function EditModal({ workspace, packages, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: workspace.name,
    status: workspace.status,
    package_id: workspace.package_id || '',
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateAdminWorkspace(workspace.id, {
        name: form.name,
        status: form.status,
        package_id: form.package_id || null,
      });
      toast.success('Workspace aggiornato');
      onSaved();
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
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Modifica Workspace</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Nome</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Stato</label>
            <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Pacchetto</label>
            <select className="input" value={form.package_id} onChange={e => setForm({ ...form, package_id: e.target.value })}>
              <option value="">— Nessun pacchetto —</option>
              {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn flex-1">Annulla</button>
            <button onClick={handleSave} disabled={loading} className="btn-primary flex-1">
              {loading ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmtpResetModal({ workspace, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleReset = async () => {
    setLoading(true);
    try {
      const res = await resetWorkspaceSmtp(workspace.id);
      setResult(res.data);
      toast.success('Password SMTP rigenerata');
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
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Reset SMTP — {workspace.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
        </div>

        {!result ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Verrà generata una nuova password SMTP per questo workspace. La password precedente non sarà più valida.
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn flex-1">Annulla</button>
              <button onClick={handleReset} disabled={loading} className="btn-primary flex-1">
                {loading ? 'Generazione…' : 'Rigenera'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-500 mb-1">SMTP Username</div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2">
                <code className="text-sm font-mono text-slate-800 dark:text-slate-200 flex-1">{result.smtp_username}</code>
                <CopyButton text={result.smtp_username} />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Nuova Password SMTP</div>
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2">
                <code className="text-sm font-mono text-slate-800 dark:text-slate-200 flex-1 break-all">{result.smtp_password}</code>
                <CopyButton text={result.smtp_password} />
              </div>
            </div>
            <button onClick={onClose} className="btn w-full mt-2">Chiudi</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState([]);
  const [editWs, setEditWs] = useState(null);
  const [smtpResetWs, setSmtpResetWs] = useState(null);
  const limit = 20;

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminWorkspaces({ page, limit, search });
      setWorkspaces(res.data.workspaces);
      setTotal(res.data.total);
    } catch (err) {
      toast.error('Errore caricamento workspace');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  useEffect(() => {
    getPackages().then(res => setPackages(res.data)).catch(() => {});
  }, []);

  const handleDelete = async (ws) => {
    if (!confirm(`Eliminare il workspace "${ws.name}" (${ws.user_email})? L'operazione è irreversibile.`)) return;
    try {
      await deleteAdminWorkspace(ws.id);
      toast.success('Workspace eliminato');
      fetchWorkspaces();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore');
    }
  };

  const statusBadge = (status) => {
    const cls = {
      active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      suspended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    }[status] || 'bg-slate-100 text-slate-600';
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{status}</span>;
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers size={22} className="text-brand-500" /> Workspace
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            {total} workspace totali
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Cerca per email, nome workspace o SMTP username…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <button onClick={fetchWorkspaces} className="btn p-2.5" title="Aggiorna">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Utente</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">SMTP Username</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Pacchetto</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stato</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Creato</th>
                <th className="py-3 px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {loading && workspaces.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Caricamento…</td></tr>
              ) : workspaces.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">Nessun workspace trovato</td></tr>
              ) : workspaces.map(ws => (
                <tr key={ws.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                  <td className="py-3 px-2">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{ws.name}</div>
                    {ws.whmcs_service_id && (
                      <div className="text-xs text-slate-400">WHMCS: {ws.whmcs_service_id}</div>
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <div className="text-slate-700 dark:text-slate-300">{ws.user_name}</div>
                    <div className="text-xs text-slate-400">{ws.user_email}</div>
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1">
                      <code className="text-xs text-slate-600 dark:text-slate-400">{ws.smtp_username}</code>
                      <CopyButton text={ws.smtp_username} />
                    </div>
                  </td>
                  <td className="py-3 px-2 text-slate-600 dark:text-slate-400 text-xs">
                    {ws.package_name || <span className="text-slate-400">—</span>}
                    {ws.monthly_limit && <span className="text-slate-400 ml-1">({ws.monthly_limit.toLocaleString()}/mo)</span>}
                  </td>
                  <td className="py-3 px-2">{statusBadge(ws.status)}</td>
                  <td className="py-3 px-2 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(ws.created_at).toLocaleDateString('it-IT')}
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setSmtpResetWs(ws)}
                        className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                        title="Reset password SMTP"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => setEditWs(ws)}
                        className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                        title="Modifica"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(ws)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Elimina"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <span className="text-sm text-slate-500">{total} workspace totali</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn py-1.5 px-3 text-sm disabled:opacity-40"
              >
                ‹ Prec
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-400 py-1.5 px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn py-1.5 px-3 text-sm disabled:opacity-40"
              >
                Succ ›
              </button>
            </div>
          </div>
        )}
      </div>

      {editWs && (
        <EditModal
          workspace={editWs}
          packages={packages}
          onClose={() => setEditWs(null)}
          onSaved={fetchWorkspaces}
        />
      )}

      {smtpResetWs && (
        <SmtpResetModal
          workspace={smtpResetWs}
          onClose={() => setSmtpResetWs(null)}
        />
      )}
    </div>
  );
}
