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

  const inputClass = 'w-full rounded-lg border border-edge bg-surface-sunken px-3 py-2 text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

  return <form onSubmit={submit} className="mx-auto min-w-0 max-w-3xl space-y-6">
    <h1 className="text-xl font-bold text-content-strong sm:text-2xl">New Primer</h1>
    {error && <div role="alert" className="break-words rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</div>}

    <div className="min-w-0 space-y-4 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6">
      <div>
        <label htmlFor="primer-topic" className="mb-1 block text-sm font-medium text-content-muted">Topic *</label>
        <input id="primer-topic" value={topic} onChange={event => setTopic(event.target.value)} className={inputClass} placeholder="e.g. Database migration guide" />
      </div>
      <div>
        <label htmlFor="primer-id" className="mb-1 block text-sm font-medium text-content-muted">ID</label>
        <input id="primer-id" value={customId || slugify(topic)} onChange={event => setCustomId(event.target.value)} className={inputClass} placeholder="generated-from-topic" />
        {!validId && id && <p className="mt-1 text-xs text-red-700 dark:text-red-400">Use lowercase letters, numbers, and hyphens only.</p>}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-content-muted">Markdown source *</legend>
        <div className="mb-3 flex flex-wrap gap-2">
          {(['paste', 'path'] as SourceMode[]).map(value => <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={`rounded-lg px-4 py-2 text-sm transition-colors ${focusRing} ${mode === value ? 'bg-accent text-accent-fg' : 'bg-control text-content hover:bg-control-hover'}`}>
            {value === 'paste' ? 'Paste Markdown' : 'Existing Path'}
          </button>)}
        </div>
        {mode === 'paste' ? <>
          <label htmlFor="primer-content" className="mb-1 block text-sm text-content-muted">Markdown content</label>
          <textarea id="primer-content" value={content} onChange={event => setContent(event.target.value)} rows={14} className={`${inputClass} font-mono text-sm`} placeholder="# Document title\n\nPaste Markdown here..." />
          <p className="mt-1 break-all text-xs text-content-subtle">Saved in the knowledge base under primer-sources/{id || '<id>'}.md.</p>
        </> : <>
          <label htmlFor="primer-source-path" className="mb-1 block text-sm text-content-muted">Source path</label>
          <input id="primer-source-path" value={sourcePath} onChange={event => setSourcePath(event.target.value)} className={`${inputClass} font-mono text-sm`} placeholder="/absolute/path/to/document.md" />
          <p className="mt-1 break-words text-xs text-content-subtle">The file must be visible to the server inside an ALGERKNOWN_CONTENT_ROOTS directory.</p>
        </>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label htmlFor="primer-document" className="mb-1 block text-sm font-medium text-content-muted">Document title</label><input id="primer-document" value={document} onChange={event => setDocument(event.target.value)} className={inputClass} /></div>
        <div><label htmlFor="primer-section" className="mb-1 block text-sm font-medium text-content-muted">Section</label><input id="primer-section" value={section} onChange={event => setSection(event.target.value)} className={inputClass} /></div>
        <div><label htmlFor="primer-tags" className="mb-1 block text-sm font-medium text-content-muted">Tags</label><input id="primer-tags" value={tagsInput} onChange={event => setTagsInput(event.target.value)} className={inputClass} placeholder="docs, architecture" /></div>
        <div><label htmlFor="primer-status" className="mb-1 block text-sm font-medium text-content-muted">Status</label><select id="primer-status" value={status} onChange={event => setStatus(event.target.value)} className={inputClass}><option value="active">Active</option><option value="planned">Planned</option><option value="reference">Reference</option><option value="archived">Archived</option><option value="blocked">Blocked</option></select></div>
      </div>
    </div>

    <button type="submit" disabled={!canSubmit || loading} className={`rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}>
      {loading ? 'Creating…' : 'Create Primer'}
    </button>
  </form>;
}
