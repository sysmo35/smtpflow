import React, { useEffect, useState } from 'react';
import { getCredentials, resetCredentials } from '../../api';
import { Copy, RefreshCw, Eye, EyeOff, Server, Lock, User, Globe, Zap, ShieldCheck, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

function CopyField({ label, value, secret = false, icon: Icon }) {
  const [show, setShow] = useState(!secret);

  const copy = () => {
    navigator.clipboard.writeText(value);
    toast.success('Copiato!');
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        {Icon && <Icon size={12} />}
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 gap-3">
          <code className="flex-1 text-sm text-slate-800 dark:text-slate-200 font-mono overflow-x-auto whitespace-nowrap">
            {show ? value : '•'.repeat(Math.min(value?.length || 10, 24))}
          </code>
          {secret && (
            <button onClick={() => setShow(!show)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0">
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </div>
        <button
          onClick={copy}
          className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          title="Copia"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
}

export default function Credentials() {
  const [creds, setCreds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    getCredentials()
      .then(res => setCreds(res.data))
      .catch(() => toast.error('Errore nel caricamento'))
      .finally(() => setLoading(false));
  }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await resetCredentials();
      setCreds(prev => ({ ...prev, ...res.data }));
      toast.success('Password SMTP reimpostata');
      setShowResetModal(false);
    } catch {
      toast.error('Errore durante il reset');
    } finally {
      setResetting(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Credenziali SMTP</h1>
        <p className="text-slate-500 text-sm mt-1">Usa queste credenziali per inviare email tramite SMTPFlow</p>
      </div>

      {/* Main credentials card */}
      <div className="card space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700/50">
          <div className="p-2.5 bg-brand-600/20 rounded-xl">
            <Server size={18} className="text-brand-500 dark:text-brand-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Configurazione Server</h3>
            <p className="text-xs text-slate-500">Impostazioni di connessione SMTP</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <CopyField label="Host SMTP" value={creds?.smtp_host} icon={Globe} />
          <CopyField label="Porta STARTTLS" value={String(creds?.smtp_port)} icon={Zap} />
          <CopyField label="Username" value={creds?.smtp_username} icon={User} />
          <CopyField label="Password" value={creds?.smtp_password} secret icon={Lock} />
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700/50">
          <p className="text-xs text-slate-500 font-medium mb-2">INFO CONNESSIONE</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Porta SSL: <span className="text-slate-700 dark:text-slate-300">{creds?.smtp_port_ssl || 465}</span></div>
            <div>Cifratura: <span className="text-slate-700 dark:text-slate-300">STARTTLS / SSL</span></div>
            <div>Auth: <span className="text-slate-700 dark:text-slate-300">PLAIN / LOGIN</span></div>
            <div>Timeout: <span className="text-slate-700 dark:text-slate-300">30 secondi</span></div>
          </div>
        </div>
      </div>

      {/* SPF DNS Record */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700/50">
          <div className="p-2.5 bg-emerald-500/15 rounded-xl">
            <ShieldCheck size={18} className="text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Record SPF</h3>
            <p className="text-xs text-slate-500">Inserisci questo record TXT nel DNS del dominio mittente</p>
          </div>
        </div>

        <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-700/30 rounded-xl p-3.5 text-xs text-emerald-700 dark:text-emerald-400">
          Questo record autorizza il nostro server a spedire email per conto del tuo dominio e migliora la deliverability.
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs text-slate-500 mb-1">
          <div>
            <p className="uppercase tracking-wider mb-1 font-medium">Tipo</p>
            <code className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-mono">TXT</code>
          </div>
          <div>
            <p className="uppercase tracking-wider mb-1 font-medium">Host / Name</p>
            <code className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-mono">@</code>
          </div>
        </div>

        <CopyField label="Valore (Value)" value={creds?.spf_record} icon={ShieldCheck} />
      </div>

      {/* DKIM Record */}
      {creds && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="p-2.5 bg-violet-500/15 rounded-xl">
              <KeyRound size={18} className="text-violet-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200">Record DKIM</h3>
              <p className="text-xs text-slate-500">Aggiungi un CNAME nel DNS del tuo dominio — stesso record per tutti i domini</p>
            </div>
          </div>

          <div className="bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-700/30 rounded-xl p-3.5 text-xs text-violet-700 dark:text-violet-400">
            Un solo record CNAME per tutti i tuoi domini. Migliora la consegna nelle caselle Gmail e Outlook.
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs text-slate-500 mb-1">
            <div>
              <p className="uppercase tracking-wider mb-1 font-medium">Tipo</p>
              <code className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-mono">CNAME</code>
            </div>
            <div className="col-span-2">
              <p className="uppercase tracking-wider mb-1 font-medium">Host / Name</p>
              <div className="flex items-center gap-2">
                <code className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-mono flex-1">
                  smtpflow._domainkey
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText('smtpflow._domainkey'); toast.success('Copiato!'); }}
                  className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 shrink-0"
                >
                  <Copy size={15} />
                </button>
              </div>
            </div>
          </div>
          <CopyField
            label="Valore (Value) — destinazione del CNAME"
            value={`smtpflow._domainkey.${creds.smtp_host}`}
            icon={KeyRound}
          />
        </div>
      )}

      {/* Quick copy all */}
      <div className="card">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">Configurazione rapida</h3>
        <p className="text-xs text-slate-500 mb-3">Copia tutto il blocco per la configurazione del tuo client</p>
        <button
          onClick={() => {
            const text = `Host: ${creds?.smtp_host}\nPorta: ${creds?.smtp_port}\nUsername: ${creds?.smtp_username}\nPassword: ${creds?.smtp_password}\nCifratura: STARTTLS`;
            navigator.clipboard.writeText(text);
            toast.success('Configurazione copiata!');
          }}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <Copy size={14} />
          Copia configurazione completa
        </button>
      </div>

      {/* Danger zone */}
      <div className="card border-red-200 dark:border-red-800/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">Reimposta Password SMTP</h3>
            <p className="text-sm text-slate-500 mt-1">Genera una nuova password. La vecchia sarà disattivata immediatamente.</p>
          </div>
          <button onClick={() => setShowResetModal(true)} className="btn-danger flex items-center gap-2 text-sm shrink-0">
            <RefreshCw size={14} />
            Reset
          </button>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Conferma reset password</h3>
            <p className="text-sm text-slate-500 mb-5">La password SMTP attuale sarà invalidata. Dovrai aggiornare tutti i client che la usano.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetModal(false)} className="btn-secondary flex-1">Annulla</button>
              <button onClick={handleReset} disabled={resetting} className="btn-danger flex-1 flex items-center justify-center gap-2">
                {resetting ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={14} />}
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
