import React, { useEffect, useState, useCallback } from 'react';
import { getEmails } from '../../api';
import { Mail, Search, Eye, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_FILTERS = [
  { value: '', label: 'Tutti' },
  { value: 'sent', label: 'Inviati' },
  { value: 'bounced', label: 'Bounce' },
  { value: 'spam', label: 'Spam' },
];

function StatusBadge({ email }) {
  if (email.spam_reported) return <span className="badge badge-spam"><ShieldAlert size={10} />Spam</span>;
  if (email.bounced) return <span className="badge badge-bounced"><AlertCircle size={10} />Bounce</span>;
  if (email.opened) return <span className="badge badge-opened"><Eye size={10} />Aperta</span>;
  return <span className="badge badge-sent"><Mail size={10} />Inviata</span>;
}

export default function History() {
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const limit = 20;

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEmails({ page, limit, search, status });
      setEmails(res.data.emails);
      setTotal(res.data.total);
    } catch {
      toast.error('Errore nel caricamento');
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => { fetchEmails(); }, [fetchEmails]);

  const pages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Email Inviate</h1>
          <p className="text-slate-500 text-sm mt-1">{total.toLocaleString()} email totali</p>
        </div>
        <button onClick={fetchEmails} className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Aggiorna
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            className="input pl-10 py-2"
            placeholder="Cerca per oggetto o destinatario..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatus(f.value); setPage(1); }}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                status === f.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200 dark:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : emails.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Mail size={36} className="mx-auto mb-3 opacity-30" />
            <p>Nessuna email trovata</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700/50">
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Destinatario</th>
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Oggetto</th>
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Aperture</th>
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stato</th>
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/30">
                  {emails.map(email => (
                    <tr
                      key={email.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer"
                      onClick={() => setSelected(selected?.id === email.id ? null : email)}
                    >
                      <td className="px-6 py-3.5">
                        <p className="text-slate-600 dark:text-slate-300 truncate max-w-48">{email.to_addresses}</p>
                      </td>
                      <td className="px-6 py-3.5">
                        <p className="text-slate-800 dark:text-slate-200 font-medium truncate max-w-56">{email.subject || '(nessun oggetto)'}</p>
                      </td>
                      <td className="px-6 py-3.5 hidden md:table-cell">
                        {email.opened ? (
                          <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                            <Eye size={14} /> {email.opened_count}x
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3.5">
                        <StatusBadge email={email} />
                      </td>
                      <td className="px-6 py-3.5 hidden lg:table-cell text-slate-500 text-xs">
                        {new Date(email.created_at).toLocaleString('it', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expanded row detail */}
            {selected && (
              <div className="border-t border-slate-200 dark:border-slate-700/50 p-6 bg-slate-50 dark:bg-slate-900/50">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-3 text-sm">Dettagli email</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500">Da:</span>
                    <p className="text-slate-700 dark:text-slate-300 mt-0.5">{selected.from_address}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">A:</span>
                    <p className="text-slate-700 dark:text-slate-300 mt-0.5 break-all">{selected.to_addresses}</p>
                  </div>
                  {selected.bounced && (
                    <div>
                      <span className="text-slate-500">Motivo bounce:</span>
                      <p className="text-red-500 dark:text-red-400 mt-0.5">{selected.bounce_message || selected.bounce_type || 'N/A'}</p>
                    </div>
                  )}
                  {selected.opened_at && (
                    <div>
                      <span className="text-slate-500">Prima apertura:</span>
                      <p className="text-slate-700 dark:text-slate-300 mt-0.5">{new Date(selected.opened_at).toLocaleString('it')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700/50">
                <span className="text-xs text-slate-500">Pagina {page} di {pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40">
                    <ChevronLeft size={14} />
                  </button>
                  <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
