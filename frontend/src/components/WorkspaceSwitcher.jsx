import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getWorkspaces, switchWorkspace as apiSwitchWorkspace, renameWorkspace } from '../api';
import { ChevronsUpDown, Check, Layers, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

export default function WorkspaceSwitcher() {
  const { workspace, switchWorkspace, updateWorkspaceName } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const ref = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = async () => {
    if (!open) {
      setLoading(true);
      try {
        const res = await getWorkspaces();
        setWorkspaces(res.data);
      } catch {
        toast.error('Errore caricamento workspace');
      } finally {
        setLoading(false);
      }
    }
    setOpen(v => !v);
  };

  const handleSwitch = async (ws) => {
    if (ws.id === workspace?.id) { setOpen(false); return; }
    try {
      const res = await apiSwitchWorkspace(ws.id);
      switchWorkspace(res.data.token, res.data.workspace);
      setOpen(false);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore cambio workspace');
    }
  };

  const startEdit = (ws) => {
    setEditing(ws.id);
    setEditName(ws.name);
  };

  const commitRename = async (wsId) => {
    const trimmed = editName.trim();
    const original = workspaces.find(w => w.id === wsId)?.name;
    setEditing(null);
    if (!trimmed || trimmed === original) return;
    try {
      await renameWorkspace(wsId, trimmed);
      setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, name: trimmed } : w));
      if (wsId === workspace?.id) updateWorkspaceName(trimmed);
      toast.success('Rinominato');
    } catch {
      toast.error('Errore rinomina');
    }
  };

  const displayName = workspace?.name || 'Workspace';

  return (
    <div ref={ref} className="relative px-4 py-2">
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Layers size={14} className="text-brand-500 shrink-0" />
        <span className="flex-1 truncate text-left font-medium">{displayName}</span>
        <ChevronsUpDown size={14} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-4 right-4 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="px-4 py-3 text-xs text-slate-500 flex items-center gap-2">
              <div className="w-3 h-3 border border-brand-500 border-t-transparent rounded-full animate-spin" />
              Caricamento…
            </div>
          ) : workspaces.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">Nessun workspace</div>
          ) : (
            <ul className="py-1 max-h-60 overflow-y-auto">
              {workspaces.map(ws => (
                <li key={ws.id} className="group flex items-center hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  {editing === ws.id ? (
                    <div className="flex-1 px-4 py-2">
                      <input
                        className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500"
                        value={editName}
                        autoFocus
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(ws.id);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        onBlur={() => commitRename(ws.id)}
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSwitch(ws)}
                        className="flex-1 flex items-center gap-2.5 px-4 py-2.5 text-sm text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{ws.name}</div>
                          {ws.package_name && (
                            <div className="text-xs text-slate-500 truncate">{ws.package_name}</div>
                          )}
                        </div>
                        {ws.id === workspace?.id && (
                          <Check size={14} className="text-brand-500 shrink-0" />
                        )}
                        {ws.status !== 'active' && (
                          <span className="text-xs text-amber-500 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded shrink-0">
                            {ws.status}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => startEdit(ws)}
                        className="opacity-0 group-hover:opacity-100 mr-3 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 shrink-0"
                        title="Rinomina"
                      >
                        <Pencil size={12} className="text-slate-400" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
