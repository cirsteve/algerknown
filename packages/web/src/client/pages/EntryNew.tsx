import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { parseContent } from '../lib/parseContent';
import { AlertBox } from '../components/molecules/AlertBox';

type InputMode = 'upload' | 'paste';

const fieldStyles =
    'w-full rounded-lg border border-edge bg-surface-raised text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

const modeButton =
    'rounded-lg px-4 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function EntryNew() {
    const navigate = useNavigate();
    const [mode, setMode] = useState<InputMode>('paste');
    const [file, setFile] = useState<File | null>(null);
    const [pasteContent, setPasteContent] = useState('');
    const [preview, setPreview] = useState<{ frontmatter: any; content: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    const parseAndPreview = useCallback((text: string) => {
        setError(null);
        setPreview(null);

        try {
            const parsed = parseContent(text);

            if (!parsed.frontmatter.id) {
                throw new Error('Must include "id" field');
            }
            if (!parsed.frontmatter.type) {
                parsed.frontmatter.type = 'entry';
            }

            setPreview(parsed);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const handleFile = useCallback(async (f: File) => {
        setFile(f);
        const text = await f.text();
        parseAndPreview(text);
    }, [parseAndPreview]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const f = e.dataTransfer.files[0];
        if (f && (f.name.endsWith('.md') || f.name.endsWith('.yaml') || f.name.endsWith('.yml'))) {
            handleFile(f);
        } else {
            setError('Please drop a .md, .yaml, or .yml file');
        }
    }, [handleFile]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
    };

    const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setPasteContent(text);
        if (text.trim()) {
            parseAndPreview(text);
        } else {
            setPreview(null);
            setError(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!preview) return;

        setLoading(true);
        setError(null);

        try {
            const entry = {
                ...preview.frontmatter,
                content: preview.content ?? preview.frontmatter.content,
                date: preview.frontmatter.date || new Date().toISOString().split('T')[0],
            };

            await api.createEntry(entry);
            navigate(`/entries/${entry.id}`);
        } catch (err) {
            setError((err as Error).message);
            setLoading(false);
        }
    };

    const clearAll = () => {
        setFile(null);
        setPasteContent('');
        setPreview(null);
        setError(null);
    };

    const modeStyles = (value: InputMode) =>
        mode === value
            ? 'bg-accent text-accent-fg'
            : 'bg-control text-content hover:bg-control-hover';

    return (
        <div className="min-w-0 space-y-6">
            <h1 className="text-xl font-bold text-content-strong sm:text-2xl">New Entry</h1>

            {/* Mode Toggle - wraps rather than overflowing at 320px */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => { setMode('paste'); clearAll(); }}
                    aria-pressed={mode === 'paste'}
                    className={`${modeButton} ${modeStyles('paste')}`}
                >
                    Paste
                </button>
                <button
                    onClick={() => { setMode('upload'); clearAll(); }}
                    aria-pressed={mode === 'upload'}
                    className={`${modeButton} ${modeStyles('upload')}`}
                >
                    Upload File
                </button>
            </div>

            {error && (
                <AlertBox variant="error">
                    <span className="block break-words">{error}</span>
                </AlertBox>
            )}

            {mode === 'paste' ? (
                <div className="space-y-2">
                    <label htmlFor="entry-paste" className="block text-sm font-medium text-content-muted">
                        Paste markdown with YAML frontmatter
                    </label>
                    <textarea
                        id="entry-paste"
                        value={pasteContent}
                        onChange={handlePasteChange}
                        placeholder={`---
id: my-entry-slug
type: entry
topic: My Topic
---

Content here...`}
                        rows={12}
                        className={`${fieldStyles} px-3 py-2 font-mono text-sm`}
                    />
                </div>
            ) : (
                <div
                    className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
                        dragActive
                            ? 'border-accent bg-accent/10'
                            : 'border-edge-strong hover:border-content-subtle'
                    }`}
                    onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                    onDrop={handleDrop}
                >
                    <input
                        type="file"
                        accept=".md,.yaml,.yml"
                        onChange={handleFileInput}
                        className="peer sr-only"
                        id="file-input"
                    />
                    {/* `sr-only` rather than `hidden` keeps the input focusable, and
                        the peer ring shows where the keyboard focus actually is. */}
                    <label
                        htmlFor="file-input"
                        className="block cursor-pointer rounded-lg p-1 peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
                    >
                        <div className="mb-2 break-words text-content-muted">
                            {file ? (
                                <span className="text-content">{file.name}</span>
                            ) : (
                                <>Drop a markdown file here or <span className="text-link underline">browse</span></>
                            )}
                        </div>
                        <p className="text-xs text-content-subtle">
                            Expects YAML frontmatter with id, type, topic fields
                        </p>
                    </label>
                </div>
            )}

            {preview && (
                <div className="min-w-0 space-y-4">
                    <h2 className="text-lg font-semibold text-content-strong">Preview</h2>
                    <div className="min-w-0 space-y-3 rounded-lg border border-edge bg-surface-raised p-4">
                        <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                            <div className="min-w-0 break-words">
                                <span className="text-content-muted">ID:</span>{' '}
                                <span className="text-content">{preview.frontmatter.id}</span>
                            </div>
                            <div className="min-w-0 break-words">
                                <span className="text-content-muted">Type:</span>{' '}
                                <span className="text-content">{preview.frontmatter.type}</span>
                            </div>
                            <div className="min-w-0 break-words">
                                <span className="text-content-muted">Topic:</span>{' '}
                                <span className="text-content">{preview.frontmatter.topic || '(not set)'}</span>
                            </div>
                            <div className="min-w-0 break-words">
                                <span className="text-content-muted">Status:</span>{' '}
                                <span className="text-content">{preview.frontmatter.status || 'active'}</span>
                            </div>
                        </div>
                        {preview.content && (
                            <div className="min-w-0">
                                <span className="text-sm text-content-muted">Content preview:</span>
                                <pre className="mt-1 max-h-40 overflow-auto rounded border border-edge bg-surface-sunken p-2 text-xs text-content">
                                    {preview.content.slice(0, 500)}{preview.content.length > 500 ? '...' : ''}
                                </pre>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? 'Creating...' : 'Create Entry'}
                        </button>
                        <button
                            type="button"
                            onClick={clearAll}
                            className="rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="min-w-0 space-y-2 text-sm text-content-subtle">
                <p className="font-medium text-content-muted">Expected format:</p>
                <pre className="overflow-auto rounded border border-edge bg-surface-raised p-3 text-xs text-content">{`---
id: my-entry-slug
type: entry
topic: My Topic
status: active
tags:
  - tag1
  - tag2
---

Optional markdown content here...`}</pre>
            </div>
        </div>
    );
}
