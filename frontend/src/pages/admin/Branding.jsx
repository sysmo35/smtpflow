import React, { useEffect, useState } from 'react';
import { useBranding, applyBrandingCssVars, BRANDING_DEFAULTS } from '../../contexts/BrandingContext';
import api from '../../api';
import toast from 'react-hot-toast';
import { Save, Zap, Palette, Globe, Mail, FileText, RefreshCw, ShieldCheck, Sun, Moon } from 'lucide-react';

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">{label}</label>
      <div className="flex items-center gap-3">
        <div className="relative">
          <input
            type="color"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-12 h-10 rounded-xl cursor-pointer border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-1"
          />
        </div>
        <input
          type="text"
          className="input flex-1 font-mono uppercase"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#6366f1"
          maxLength={7}
        />
      </div>
    </div>
  );
}

function SidebarPreview({ form }) {
  const navItems = ['Dashboard', 'Utenti', 'Pacchetti', 'Branding'];
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-surface-900 overflow-hidden shadow-2xl">
      {/* Sidebar preview — intentionally always dark to show branding */}
      <div className="w-52 bg-surface-800 p-4 space-y-1">
        {/* Logo */}
        <div className="flex items-center gap-3 pb-4 mb-3 border-b border-slate-700/40">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shrink-0 overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.secondary_color})` }}
          >
            {form.logo_url ? (
              <img src={form.logo_url} alt="logo" className="w-full h-full object-cover" onError={e => { e.target.style.display='none'; }} />
            ) : (
              <Zap size={16} className="text-white" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-100 text-sm truncate">{form.app_name || 'SMTPFlow'}</p>
            <p className="text-xs text-slate-500">Admin Panel</p>
          </div>
        </div>

        {/* Nav items */}
        {navItems.map((item, i) => (
          <div
            key={item}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
            style={i === 0 ? {
              backgroundColor: `${form.primary_color}20`,
              color: form.primary_color,
              border: `1px solid ${form.primary_color}30`,
            } : { color: '#94a3b8' }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: i === 0 ? form.primary_color : '#475569' }}
            />
            {item}
          </div>
        ))}

        {/* Footer */}
        {form.footer_text && (
          <p className="text-xs text-slate-600 pt-3 border-t border-slate-700/40 mt-3 break-words">
            {form.footer_text}
          </p>
        )}
      </div>

      {/* Color swatches */}
      <div className="flex border-t border-slate-700/50">
        <div className="flex-1 h-8" style={{ background: form.primary_color }} />
        <div className="flex-1 h-8" style={{ background: form.secondary_color }} />
      </div>
    </div>
  );
}

export default function AdminBranding() {
  const { branding, setBranding } = useBranding();
  const [form, setForm] = useState({ ...BRANDING_DEFAULTS, ...branding });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...BRANDING_DEFAULTS, ...branding });
  }, [branding]);

  // Applica CSS vars in tempo reale mentre si modifica
  useEffect(() => {
    applyBrandingCssVars(form);
  }, [form.primary_color, form.secondary_color]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/admin/branding', form);
      setBranding(res.data);
      applyBrandingCssVars(res.data);
      toast.success('Branding salvato con successo');
    } catch {
      toast.error('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm({ ...BRANDING_DEFAULTS });
    applyBrandingCssVars(BRANDING_DEFAULTS);
    toast('Ripristinato ai valori predefiniti — salva per confermare', { icon: '↩️' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Branding</h1>
          <p className="text-slate-500 text-sm mt-1">Personalizza l'aspetto dell'applicazione per i tuoi clienti</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleReset} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} /> Reset
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Salvataggio...</>
              : <><Save size={16} /> Salva</>
            }
          </button>
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        {/* Form — 2 colonne */}
        <div className="xl:col-span-2 space-y-5">

          {/* Identità */}
          <div className="card">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <Globe size={16} className="text-brand-500 dark:text-brand-400" /> Identità
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Nome applicazione
                </label>
                <input
                  type="text"
                  className="input"
                  value={form.app_name}
                  onChange={e => set('app_name', e.target.value)}
                  placeholder="SMTPFlow"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Logo URL
                </label>
                <input
                  type="url"
                  className="input"
                  value={form.logo_url}
                  onChange={e => set('logo_url', e.target.value)}
                  placeholder="https://cdn.example.com/logo.png"
                />
                <p className="text-xs text-slate-400 mt-1.5">Consigliato: 40×40px, PNG/SVG</p>
              </div>
            </div>
          </div>

          {/* Colori */}
          <div className="card">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <Palette size={16} className="text-brand-500 dark:text-brand-400" /> Colori
            </h3>
            <div className="grid md:grid-cols-2 gap-5">
              <ColorField
                label="Colore primario"
                value={form.primary_color}
                onChange={v => set('primary_color', v)}
              />
              <ColorField
                label="Colore secondario"
                value={form.secondary_color}
                onChange={v => set('secondary_color', v)}
              />
            </div>
            <div className="mt-4 flex gap-1 h-6 rounded-lg overflow-hidden">
              {[form.primary_color, form.secondary_color, '#1e293b', '#0f172a', '#334155'].map((c, i) => (
                <div key={i} className="flex-1" style={{ background: c }} />
              ))}
            </div>
          </div>

          {/* Contatti e footer */}
          <div className="card">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <Mail size={16} className="text-brand-500 dark:text-brand-400" /> Contatti e testi
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Email supporto
                </label>
                <input
                  type="email"
                  className="input"
                  value={form.support_email}
                  onChange={e => set('support_email', e.target.value)}
                  placeholder="support@tuazienda.com"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  <FileText size={12} className="inline mr-1" />
                  Testo footer sidebar
                </label>
                <input
                  type="text"
                  className="input"
                  value={form.footer_text}
                  onChange={e => set('footer_text', e.target.value)}
                  placeholder="© 2025 La Tua Azienda"
                />
              </div>
            </div>
          </div>

          {/* Record SPF */}
          <div className="card">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-2">
              <ShieldCheck size={16} className="text-brand-500 dark:text-brand-400" /> Record SPF
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Questo record viene mostrato ai clienti nella pagina Credenziali SMTP, come istruzione DNS da inserire sul loro dominio mittente.
            </p>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                Valore record TXT
              </label>
              <input
                type="text"
                className="input font-mono text-xs"
                value={form.spf_record}
                onChange={e => set('spf_record', e.target.value)}
                placeholder={`v=spf1 include:_spf.tuodominio.com ~all`}
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Il record verrà mostrato agli utenti con Tipo <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">TXT</code> e Host <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">@</code>
              </p>
            </div>
          </div>

          {/* Tema predefinito */}
          <div className="card">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-2">
              <Sun size={16} className="text-brand-500 dark:text-brand-400" /> Tema predefinito
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Tema applicato ai nuovi utenti che non hanno ancora una preferenza salvata.
            </p>
            <div className="flex gap-3">
              {[
                { value: 'auto', label: 'Auto (sistema)', icon: null },
                { value: 'light', label: 'Chiaro', icon: Sun },
                { value: 'dark', label: 'Scuro', icon: Moon },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('default_theme', value)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all ${
                    form.default_theme === value
                      ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {Icon && <Icon size={14} />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview — 1 colonna */}
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse inline-block" />
              Preview live
            </p>
            <SidebarPreview form={form} />
          </div>

          {/* Info pill */}
          <div className="rounded-xl bg-brand-500/5 border border-brand-500/10 p-4 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
            <p className="text-slate-800 dark:text-slate-300 font-medium">Come funziona</p>
            <p>Il branding si applica immediatamente a tutti gli utenti senza riavvio.</p>
            <p>Il logo URL deve essere raggiungibile pubblicamente (CDN o hosting esterno).</p>
            {form.support_email && (
              <p>Email supporto visibile nella pagina di login e nella dashboard utente.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
