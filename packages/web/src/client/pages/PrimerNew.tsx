import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type SourceMode = 'path' | 'paste';

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);

export function PrimerNew() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<SourceMode>('paste');
  const [topic, setTopic] = useState('');
  const [customId, setCustomId] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [content, setContent] = useState('');
  const [document, setDocument] = useState('');
  const [section, setSection] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const id = customId || slugify(topic);
  const validId = /^[a-z0-9-]+$/.test(id);
  const hasSource = mode === 'path' ? sourcePath.trim().length > 0 : content.trim().length > 0;
  const canSubmit = topic.trim().length > 0 && validId && hasSource;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await api.createPrimer({
        id,
        topic: topic.trim(),
        status,
        tags: tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean),
        document: document.trim() || undefined,
        section: section.trim() || undefined,
        source: mode === 'path' ? { path: sourcePath.trim() } : {},
        content: mode === 'paste' ? content : undefined,
      });
      navigate(`/primers/${encodeURIComponent(id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create primer');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none';

  return <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold text-slate-100">New Primer</h1>
    {error && <div className="rounded-lg border border-red-500 bg-red-900/50 p-4 text-red-200">{error}</div>}

    <div className="space-y-4 rounded-lg bg-slate-800 p-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-400">Topic *</label>
        <input value={topic} onChange={event => setTopic(event.target.value)} className={inputClass} placeholder="e.g. Database migration guide" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-400">ID</label>
        <input value={customId || slugify(topic)} onChange={event => setCustomId(event.target.value)} className={inputClass} placeholder="generated-from-topic" />
        {!validId && id && <p className="mt-1 text-xs text-red-400">Use lowercase letters, numbers, and hyphens only.</p>}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-400">Markdown source *</legend>
        <div className="mb-3 flex gap-2">
          {(['paste', 'path'] as SourceMode[]).map(value => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg px-4 py-2 text-sm ${mode === value ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {value === 'paste' ? 'Paste Markdown' : 'Existing Path'}
          </button>)}
        </div>
        {mode === 'paste' ? <>
          <textarea value={content} onChange={event => setContent(event.target.value)} rows={14} className={`${inputClass} font-mono text-sm`} placeholder="# Document title\n\nPaste Markdown here..." />
          <p className="mt-1 text-xs text-slate-500">Saved in the knowledge base under primer-sources/{id || '<id>'}.md.</p>
        </> : <>
          <input value={sourcePath} onChange={event => setSourcePath(event.target.value)} className={`${inputClass} font-mono text-sm`} placeholder="/absolute/path/to/document.md" />
          <p className="mt-1 text-xs text-slate-500">The file must be visible to the server inside an ALGERKNOWN_CONTENT_ROOTS directory.</p>
        </>}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <div><label className="mb-1 block text-sm font-medium text-slate-400">Document title</label><input value={document} onChange={event => setDocument(event.target.value)} className={inputClass} /></div>
        <div><label className="mb-1 block text-sm font-medium text-slate-400">Section</label><input value={section} onChange={event => setSection(event.target.value)} className={inputClass} /></div>
        <div><label className="mb-1 block text-sm font-medium text-slate-400">Tags</label><input value={tagsInput} onChange={event => setTagsInput(event.target.value)} className={inputClass} placeholder="docs, architecture" /></div>
        <div><label className="mb-1 block text-sm font-medium text-slate-400">Status</label><select value={status} onChange={event => setStatus(event.target.value)} className={inputClass}><option value="active">Active</option><option value="planned">Planned</option><option value="reference">Reference</option><option value="archived">Archived</option><option value="blocked">Blocked</option></select></div>
      </div>
    </div>

    <button type="submit" disabled={!canSubmit || loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
      {loading ? 'Creating…' : 'Create Primer'}
    </button>
  </form>;
}
