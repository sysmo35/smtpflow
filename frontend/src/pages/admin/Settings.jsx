import React, { useEffect, useState } from 'react';
import { getAdminSettings, updateAdminSettings, generateProvisionKey } from '../../api';
import { Key, RefreshCw, Save, Eye, EyeOff, CheckCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [apiKey, setApiKey]     = useState('');
  const [showKey, setShowKey]   = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then(res => setSettings(res.data))
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
      // Reload settings to update source indicator
      const res = await getAdminSettings();
      setSettings(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
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
    </div>
  );
}
