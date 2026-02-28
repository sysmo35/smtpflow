import React, { useEffect, useState } from 'react';
import { getDomains, addDomain, verifyDomain, deleteDomain, getDomainDns } from '../../api';
import {
  Globe, Plus, CheckCircle2, XCircle, Clock, Trash2,
  RefreshCw, Copy, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

function StatusIcon({ verified }) {
  if (verified === true) return <CheckCircle2 size={14} className="text-green-500" />;
  if (verified === false) return <XCircle size={14} className="text-slate-400 dark:text-slate-600" />;
  return <Clock size={14} className="text-yellow-500" />;
}

const TYPE_COLORS = {
  TXT: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
  CNAME: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400',
  MX: 'bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400',
};

function DnsRecord({ record }) {
  const copy = (val) => { navigator.clipboard.writeText(val); toast.success('Copiato!'); };
  return (
    <div className={`rounded-xl bg-slate-50 dark:bg-slate-900/60 border p-4 space-y-2 ${record.required ? 'border-brand-500/30' : 'border-slate-200 dark:border-slate-700/50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`badge border text-xs ${TYPE_COLORS[record.type] || 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400'}`}>
            {record.type}
          </span>
          {record.required && (
            <span className="badge bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20 text-xs">Obbligatorio</span>
          )}
        </div>
        <span className="text-xs text-slate-500">{record.description}</span>
      </div>
      <div className="grid gap-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-12 shrink-0">Host:</span>
          <code className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded flex-1 truncate">{record.host}</code>
          <button onClick={() => copy(record.host)} className="text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 shrink-0"><Copy size={12} /></button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-12 shrink-0">Valore:</span>
          <code className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded flex-1 break-all">{record.value}</code>
          <button onClick={() => copy(record.value)} className="text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 shrink-0"><Copy size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export default function Domains() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [dnsRecords, setDnsRecords] = useState({});
  const [verifying, setVerifying] = useState(null);

  useEffect(() => {
    getDomains()
      .then(res => setDomains(res.data))
      .catch(() => toast.error('Errore nel caricamento'))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    setAdding(true);
    try {
      const res = await addDomain({ domain });
      setDomains(prev => [res.data, ...prev]);
      setDnsRecords(prev => ({ ...prev, [res.data.id]: res.data.dns_records }));
      setExpanded(res.data.id);
      setNewDomain('');
      toast.success('Dominio aggiunto! Configura i record DNS qui sotto.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore aggiunta dominio');
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (id) => {
    setVerifying(id);
    try {
      const res = await verifyDomain(id);
      setDomains(prev => prev.map(d => d.id === id ? res.data : d));
      if (res.data.status === 'verified') {
        toast.success('Dominio verificato!');
      } else {
        toast('Verifica incompleta. Controlla i record DNS.', { icon: '⚠️' });
      }
    } catch {
      toast.error('Errore durante la verifica');
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async (id, domain) => {
    if (!confirm(`Eliminare il dominio ${domain}?`)) return;
    try {
      await deleteDomain(id);
      setDomains(prev => prev.filter(d => d.id !== id));
      toast.success('Dominio eliminato');
    } catch {
      toast.error('Errore eliminazione');
    }
  };

  const toggleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!dnsRecords[id]) {
      try {
        const res = await getDomainDns(id);
        setDnsRecords(prev => ({ ...prev, [id]: res.data.dns_records }));
      } catch {}
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Domini</h1>
        <p className="text-slate-500 text-sm mt-1">Aggiungi e verifica i tuoi domini per inviare email personalizzate</p>
      </div>

      {/* Add domain form */}
      <div className="card">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
          <Plus size={16} className="text-brand-500 dark:text-brand-400" />
          Aggiungi dominio
        </h3>
        <form onSubmit={handleAdd} className="flex gap-3">
          <div className="relative flex-1">
            <Globe size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              className="input pl-10"
              placeholder="tuodominio.com"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
            />
          </div>
          <button type="submit" disabled={adding || !newDomain.trim()} className="btn-primary flex items-center gap-2">
            {adding ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
            Aggiungi
          </button>
        </form>
      </div>

      {/* Domains list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : domains.length === 0 ? (
        <div className="card text-center py-12">
          <Globe size={36} className="mx-auto mb-3 text-slate-400" />
          <p className="text-slate-500">Nessun dominio configurato</p>
          <p className="text-slate-400 text-sm mt-1">Aggiungi il tuo primo dominio qui sopra</p>
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map(domain => (
            <div key={domain.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-4 p-4">
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  domain.status === 'verified' ? 'bg-green-400' :
                  domain.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{domain.domain}</span>
                    <span className={`badge border text-xs ${
                      domain.status === 'verified' ? 'badge-verified' :
                      domain.status === 'failed' ? 'badge-bounced' : 'badge-pending'
                    }`}>
                      {domain.status === 'verified' ? 'Verificato' : domain.status === 'failed' ? 'Fallito' : 'In attesa'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5">
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <StatusIcon verified={domain.spf_verified} />
                      SPF
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <StatusIcon verified={domain.dkim_verified} />
                      DKIM
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <StatusIcon verified={domain.mx_verified} />
                      MX
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleVerify(domain.id)}
                    disabled={verifying === domain.id}
                    className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                  >
                    <RefreshCw size={12} className={verifying === domain.id ? 'animate-spin' : ''} />
                    Verifica
                  </button>
                  <button
                    onClick={() => toggleExpand(domain.id)}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                  >
                    {expanded === domain.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <button
                    onClick={() => handleDelete(domain.id, domain.domain)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:text-slate-600 dark:hover:text-red-400 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* DNS Records */}
              {expanded === domain.id && (
                <div className="border-t border-slate-200 dark:border-slate-700/50 p-4 bg-slate-50/50 dark:bg-slate-900/30">
                  <div className="flex items-start gap-2 mb-4 bg-brand-500/5 border border-brand-500/10 rounded-xl p-3">
                    <AlertCircle size={14} className="text-brand-500 dark:text-brand-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      <p><span className="text-slate-800 dark:text-slate-200 font-medium">Solo 1 record obbligatorio:</span> aggiungi il record SPF nel pannello DNS del tuo provider.</p>
                      <p>Il record CNAME (DKIM) e DMARC sono opzionali ma migliorano la consegna nelle caselle Gmail/Outlook.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {(dnsRecords[domain.id] || []).map((record, i) => (
                      <DnsRecord key={i} record={record} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
