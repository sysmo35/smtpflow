import React, { useEffect, useState } from 'react';
import { getAdminSettings, updateAdminSettings, generateProvisionKey } from '../../api';
import { Key, RefreshCw, Save, Eye, EyeOff, CheckCircle, Info, Shield, AlertTriangle, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savingDns, setSavingDns] = useState(false);
  const [apiKey, setApiKey]     = useState('');
  const [showKey, setShowKey]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [spfRecord, setSpfRecord] = useState('');
  const [dkimSelector, setDkimSelector] = useState('');
  const [savingBounce, setSavingBounce] = useState(false);
  const [bounceSubject, setBounceSubject] = useState('');
  const [bounceBody, setBounceBody] = useState('');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpSystem, setSmtpSystem] = useState({ host: '', port: '587', user: '', pass: '', from: '' });

  const DEFAULT_BOUNCE_SUBJECT = 'Mancata consegna: {subject}';
  const DEFAULT_BOUNCE_BODY = 'La tua email non è stata consegnata a: {to}\nOggetto: {subject}\n\nMotivo: {reason}\n\nQuesto è un messaggio automatico, non rispondere.';

  useEffect(() => {
    getAdminSettings()
      .then(res => {
        setSettings(res.data);
        setSpfRecord(res.data.spf_record || '');
        setDkimSelector(res.data.dkim_selector || 'smtpflow');
        setBounceSubject(res.data.bounce_notification_subject || DEFAULT_BOUNCE_SUBJECT);
        setBounceBody(res.data.bounce_notification_body || DEFAULT_BOUNCE_BODY);
        setSmtpSystem({
          host: res.data.smtp_system_host || '',
          port: res.data.smtp_system_port || '587',
          user: res.data.smtp_system_user || '',
          pass: '',
          from: res.data.smtp_system_from || '',
        });
      })
      .catch(() => toast.error('Errore nel caricamento settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await generateProvisionKey();
      setApiKey(res.data.key);
      setShowKey(true);
      toast.success('Chiave generata — salvala prima di uscire');
    } catch {
      toast.error('Errore nella generazione');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!apiKey || apiKey.length < 16) {
      toast.error('La chiave deve essere almeno 16 caratteri');
      return;
    }
    setSaving(true);
    try {
      await updateAdminSettings({ provision_api_key: apiKey });
      toast.success('API key salvata');
      setApiKey('');
      const res = await getAdminSettings();
      setSettings(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDns = async (e) => {
    e.preventDefault();
    if (!spfRecord.trim()) {
      toast.error('Il record SPF non può essere vuoto');
      return;
    }
    if (!spfRecord.startsWith('v=spf1')) {
      toast.error('Il record SPF deve iniziare con v=spf1');
      return;
    }
    if (!dkimSelector.trim()) {
      toast.error('Il nome DKIM non può essere vuoto');
      return;
    }
    setSavingDns(true);
    try {
      await updateAdminSettings({ spf_record: spfRecord.trim(), dkim_selector: dkimSelector.trim() });
      toast.success('Impostazioni DNS salvate');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore nel salvataggio');
    } finally {
      setSavingDns(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Impostazioni</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Configurazione dell'integrazione WHMCS e provisioning</p>
      </div>

      {/* Provisioning API Key */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
            <Key size={20} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Provisioning API Key</h2>
            <p className="text-xs text-slate-500">Usata da WHMCS per creare/sospendere account</p>
          </div>
        </div>

        {/* Current status */}
        {settings && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg mb-4 ${
            settings.provision_api_key_set
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
          }`}>
            {settings.provision_api_key_set
              ? <><CheckCircle size={15} /> Chiave configurata ({settings.provision_api_key_source === 'database' ? 'salvata nel DB' : 'da variabile .env'})</>
              : <><Info size={15} /> Nessuna chiave configurata — il provisioning WHMCS non funzionerà</>
            }
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Nuova API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Incolla o genera una nuova chiave…"
                className="input pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Minimo 16 caratteri. La chiave attuale non è visibile per sicurezza.</p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={15} className={generating ? 'animate-spin' : ''} />
              Genera chiave
            </button>
            <button
              type="submit"
              disabled={saving || !apiKey}
              className="btn-primary flex items-center gap-2"
            >
              <Save size={15} />
              {saving ? 'Salvataggio…' : 'Salva API key'}
            </button>
          </div>
        </form>

        <div className="mt-5 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-600 dark:text-slate-400">Configurazione WHMCS</p>
          <p>Copia questa chiave nel modulo WHMCS: <em>Prodotti → Modulo → Provisioning API Key</em></p>
          <p>Oppure impostala nella variabile d'ambiente <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">PROVISION_API_KEY</code> del server.</p>
        </div>
      </div>

      {/* DNS / Email authentication */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
            <Shield size={20} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Autenticazione email</h2>
            <p className="text-xs text-slate-500">Record SPF e nome selettore DKIM mostrati agli utenti</p>
          </div>
        </div>

        <form onSubmit={handleSaveDns} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Record SPF
            </label>
            <input
              type="text"
              value={spfRecord}
              onChange={e => setSpfRecord(e.target.value)}
              placeholder="v=spf1 ip4:1.2.3.4 ~all"
              className="input font-mono text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">
              Deve contenere <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">ip4:X.X.X.X</code> o <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">include:tuodominio</code> — usato per verificare i domini degli utenti.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Nome selettore DKIM
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={dkimSelector}
                onChange={e => setDkimSelector(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="smtpflow"
                className="input font-mono text-sm max-w-xs"
              />
              <span className="text-sm text-slate-400 font-mono">._domainkey.tuodominio.com</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Applicato ai nuovi domini. I domini già aggiunti mantengono il selettore precedente.
            </p>
          </div>

          <button
            type="submit"
            disabled={savingDns}
            className="btn-primary flex items-center gap-2"
          >
            <Save size={15} />
            {savingDns ? 'Salvataggio…' : 'Salva impostazioni DNS'}
          </button>
        </form>
      </div>

      {/* Bounce notification */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Notifica mancata consegna</h2>
            <p className="text-xs text-slate-500">Email inviata al mittente in caso di hard bounce</p>
          </div>
        </div>

        <form onSubmit={async (e) => {
          e.preventDefault();
          setSavingBounce(true);
          try {
            await updateAdminSettings({ bounce_notification_subject: bounceSubject, bounce_notification_body: bounceBody });
            toast.success('Messaggio di bounce salvato');
          } catch (err) {
            toast.error(err.response?.data?.error || 'Errore nel salvataggio');
          } finally {
            setSavingBounce(false);
          }
        }} className="space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-slate-500">
            Variabili disponibili:&nbsp;
            <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">{'{to}'}</code> destinatario,&nbsp;
            <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">{'{subject}'}</code> oggetto originale,&nbsp;
            <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">{'{reason}'}</code> motivo del bounce
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Oggetto
            </label>
            <input
              type="text"
              value={bounceSubject}
              onChange={e => setBounceSubject(e.target.value)}
              className="input text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Corpo del messaggio
            </label>
            <textarea
              value={bounceBody}
              onChange={e => setBounceBody(e.target.value)}
              rows={6}
              className="input text-sm font-mono resize-y"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setBounceSubject(DEFAULT_BOUNCE_SUBJECT); setBounceBody(DEFAULT_BOUNCE_BODY); }}
              className="btn-secondary text-sm"
            >
              Ripristina default
            </button>
            <button
              type="submit"
              disabled={savingBounce}
              className="btn-primary flex items-center gap-2"
            >
              <Save size={15} />
              {savingBounce ? 'Salvataggio…' : 'Salva messaggio'}
            </button>
          </div>
        </form>
      </div>

      {/* SMTP di sistema (password reset) */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
            <Mail size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">SMTP di sistema</h2>
            <p className="text-xs text-slate-500">Server usato per inviare email di reset password</p>
          </div>
        </div>

        <form onSubmit={async (e) => {
          e.preventDefault();
          setSavingSmtp(true);
          try {
            const payload = {
              smtp_system_host: smtpSystem.host,
              smtp_system_port: smtpSystem.port,
              smtp_system_user: smtpSystem.user,
              smtp_system_from: smtpSystem.from,
            };
            if (smtpSystem.pass) payload.smtp_system_pass = smtpSystem.pass;
            await updateAdminSettings(payload);
            toast.success('SMTP di sistema salvato');
          } catch (err) {
            toast.error(err.response?.data?.error || 'Errore nel salvataggio');
          } finally {
            setSavingSmtp(false);
          }
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Host SMTP</label>
              <input type="text" value={smtpSystem.host} onChange={e => setSmtpSystem(s => ({ ...s, host: e.target.value }))}
                placeholder="smtp.esempio.com" className="input text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Porta</label>
              <input type="number" value={smtpSystem.port} onChange={e => setSmtpSystem(s => ({ ...s, port: e.target.value }))}
                placeholder="587" className="input text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Utente SMTP</label>
              <input type="text" value={smtpSystem.user} onChange={e => setSmtpSystem(s => ({ ...s, user: e.target.value }))}
                placeholder="user@esempio.com" className="input text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password SMTP</label>
              <input type="password" value={smtpSystem.pass} onChange={e => setSmtpSystem(s => ({ ...s, pass: e.target.value }))}
                placeholder="Lascia vuoto per non modificare" className="input text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Indirizzo mittente</label>
            <input type="email" value={smtpSystem.from} onChange={e => setSmtpSystem(s => ({ ...s, from: e.target.value }))}
              placeholder="noreply@esempio.com" className="input text-sm" />
          </div>
          <button type="submit" disabled={savingSmtp} className="btn-primary flex items-center gap-2">
            <Save size={15} />
            {savingSmtp ? 'Salvataggio…' : 'Salva SMTP di sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}
