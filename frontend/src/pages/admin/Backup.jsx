import React, { useState, useEffect, useCallback } from 'react';
import axios from '../../api/index.js';
import toast from 'react-hot-toast';
import {
  HardDrive, Upload, Download, Trash2, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Loader2, Server,
  Database, Key, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT');
}

const Card = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-surface-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6 ${className}`}>
    {children}
  </div>
);

const Section = ({ title, icon: Icon, children }) => (
  <Card>
    <div className="flex items-center gap-2 mb-5">
      <Icon size={18} className="text-brand-500" />
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
    </div>
    {children}
  </Card>
);

const Input = ({ label, ...props }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
    <input
      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition"
      {...props}
    />
  </div>
);

const Btn = ({ children, onClick, disabled, variant = 'primary', size = 'sm', className = '', loading = false }) => {
  const base = 'inline-flex items-center gap-2 font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  const variants = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-white',
    secondary: 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    ghost: 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
};

export default function AdminBackup() {
  const [cfg, setCfg] = useState({ host: '', port: '22', username: '', password: '', remote_path: '/backups' });
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | {ok, message} | {error}

  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [restoring, setRestoring] = useState(null); // filename being restored
  const [restoreResult, setRestoreResult] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load SFTP config
  useEffect(() => {
    axios.get('/api/admin/backup/config')
      .then(r => setCfg(r.data))
      .catch(() => {})
      .finally(() => setCfgLoading(false));
  }, []);

  // Load backup list
  const loadBackups = useCallback(() => {
    setBackupsLoading(true);
    axios.get('/api/admin/backup/list')
      .then(r => setBackups(r.data.backups || []))
      .catch(e => toast.error(e.response?.data?.error || 'Errore caricamento lista backup'))
      .finally(() => setBackupsLoading(false));
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const saveCfg = async () => {
    setCfgSaving(true);
    setTestResult(null);
    try {
      await axios.put('/api/admin/backup/config', cfg);
      toast.success('Configurazione SFTP salvata');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Errore salvataggio');
    } finally {
      setCfgSaving(false);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await axios.post('/api/admin/backup/test');
      setTestResult({ ok: true, message: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.error || 'Connessione fallita' });
    } finally {
      setTesting(false);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    setRestoreResult(null);
    try {
      const r = await axios.post('/api/admin/backup/create');
      toast.success(`Backup creato: ${r.data.filename} (${formatBytes(r.data.size)})`);
      loadBackups();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Errore creazione backup');
    } finally {
      setCreating(false);
    }
  };

  const doRestore = async (filename) => {
    if (!window.confirm(`Ripristinare da "${filename}"?\n\nQuesta operazione sovrascriverà tutti i dati correnti del database e le chiavi DKIM. L'applicazione dovrà essere riavviata dopo il ripristino.`)) return;
    setRestoring(filename);
    setRestoreResult(null);
    try {
      const r = await axios.post('/api/admin/backup/restore', { filename });
      setRestoreResult({ ok: true, filename, results: r.data.results });
      toast.success('Ripristino completato');
    } catch (e) {
      setRestoreResult({ ok: false, filename, error: e.response?.data?.error || 'Errore ripristino' });
      toast.error(e.response?.data?.error || 'Errore ripristino');
    } finally {
      setRestoring(null);
    }
  };

  const doDelete = async (filename) => {
    if (!window.confirm(`Eliminare il backup "${filename}"?`)) return;
    setDeleting(filename);
    try {
      await axios.delete(`/api/admin/backup/${encodeURIComponent(filename)}`);
      toast.success('Backup eliminato');
      setBackups(prev => prev.filter(b => b.name !== filename));
    } catch (e) {
      toast.error(e.response?.data?.error || 'Errore eliminazione');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Backup & Ripristino</h1>
        <p className="text-sm text-slate-500 mt-1">
          Crea backup del database, chiavi DKIM e configurazione e salvali su un server SFTP remoto.
        </p>
      </div>

      {/* What gets backed up */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: Database, label: 'Database PostgreSQL', desc: 'Tutti i dati, utenti, email, impostazioni' },
          { icon: Key, label: 'Chiavi DKIM', desc: 'Chiavi private per firma email' },
          { icon: FileText, label: 'File .env', desc: 'Configurazione e segreti applicazione' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-start gap-3 p-3 rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20">
            <Icon size={16} className="text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-brand-800 dark:text-brand-300">{label}</div>
              <div className="text-xs text-brand-600/70 dark:text-brand-400/70 mt-0.5">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* SFTP Configuration */}
      <Section title="Configurazione SFTP" icon={Server}>
        {cfgLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 size={14} className="animate-spin" /> Caricamento...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Input label="Host SFTP" value={cfg.host} onChange={e => setCfg(p => ({ ...p, host: e.target.value }))} placeholder="es. backup.example.com" />
              </div>
              <Input label="Porta" type="number" value={cfg.port} onChange={e => setCfg(p => ({ ...p, port: e.target.value }))} placeholder="22" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Username" value={cfg.username} onChange={e => setCfg(p => ({ ...p, username: e.target.value }))} placeholder="utente SFTP" />
              <Input label="Password" type="password" value={cfg.password} onChange={e => setCfg(p => ({ ...p, password: e.target.value }))} placeholder="••••••••" autoComplete="new-password" />
            </div>

            <button
              onClick={() => setShowAdvanced(p => !p)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
            >
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Opzioni avanzate
            </button>

            {showAdvanced && (
              <Input label="Percorso remoto" value={cfg.remote_path} onChange={e => setCfg(p => ({ ...p, remote_path: e.target.value }))} placeholder="/backups" />
            )}

            {/* Test result */}
            {testResult && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-xl ${testResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {testResult.message}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Btn onClick={saveCfg} loading={cfgSaving} size="md">Salva configurazione</Btn>
              <Btn variant="secondary" onClick={testConn} loading={testing} size="md">
                <CheckCircle size={14} />
                Testa connessione
              </Btn>
            </div>
          </div>
        )}
      </Section>

      {/* Create backup */}
      <Section title="Crea Backup" icon={Upload}>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Crea un archivio compresso con database, chiavi DKIM e configurazione, quindi caricalo sul server SFTP configurato.
        </p>
        <Btn onClick={createBackup} loading={creating} size="md">
          <HardDrive size={15} />
          {creating ? 'Creazione in corso...' : 'Avvia backup ora'}
        </Btn>
      </Section>

      {/* Restore result */}
      {restoreResult && (
        <div className={`rounded-2xl border p-4 ${restoreResult.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50'}`}>
          <div className="flex items-start gap-2">
            {restoreResult.ok ? <CheckCircle size={16} className="text-green-600 dark:text-green-400 mt-0.5 shrink-0" /> : <XCircle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />}
            <div className="flex-1">
              <div className={`text-sm font-semibold ${restoreResult.ok ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                {restoreResult.ok ? `Ripristino da "${restoreResult.filename}" completato` : `Ripristino fallito: ${restoreResult.error}`}
              </div>
              {restoreResult.ok && restoreResult.results && (
                <ul className="mt-2 space-y-1">
                  <li className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                    {restoreResult.results.db ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    Database: {restoreResult.results.db ? 'ripristinato' : 'non ripristinato'}
                  </li>
                  <li className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                    {restoreResult.results.dkim ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    Chiavi DKIM: {restoreResult.results.dkim ? 'ripristinate' : 'non trovate'}
                  </li>
                  {restoreResult.results.env_available && (
                    <li className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      File .env disponibile nel backup — richiede sostituzione manuale e riavvio app
                    </li>
                  )}
                </ul>
              )}
              {restoreResult.ok && (
                <div className="mt-2 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded-lg">
                  <AlertTriangle size={12} className="shrink-0" />
                  Riavvia l'applicazione per applicare completamente le modifiche.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Backup list */}
      <Section title="Backup Disponibili" icon={HardDrive}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {backups.length} backup sul server SFTP
          </span>
          <Btn variant="ghost" onClick={loadBackups} loading={backupsLoading} size="sm">
            <RefreshCw size={13} />
            Aggiorna
          </Btn>
        </div>

        {backupsLoading && backups.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Caricamento lista backup...
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            <HardDrive size={32} className="mx-auto mb-2 opacity-30" />
            Nessun backup trovato sul server SFTP
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map(b => (
              <div
                key={b.name}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/50"
              >
                <HardDrive size={15} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{b.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatDate(b.modified)} · {formatBytes(b.size)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Btn
                    variant="secondary"
                    size="sm"
                    onClick={() => doRestore(b.name)}
                    loading={restoring === b.name}
                    disabled={!!restoring || !!deleting}
                  >
                    <Download size={13} />
                    Ripristina
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => doDelete(b.name)}
                    loading={deleting === b.name}
                    disabled={!!restoring || !!deleting}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={13} />
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
