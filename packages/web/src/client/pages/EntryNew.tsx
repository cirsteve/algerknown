import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { parseContent } from '../lib/parseContent';

type InputMode = 'upload' | 'paste';

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

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-100">New Entry</h1>

            {/* Mode Toggle */}
            <div className="flex gap-2">
                <button
                    onClick={() => { setMode('paste'); clearAll(); }}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        mode === 'paste'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                >
                    Paste
                </button>
                <button
                    onClick={() => { setMode('upload'); clearAll(); }}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        mode === 'upload'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                >
                    Upload File
                </button>
            </div>

            {error && (
                <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
                    {error}
                </div>
            )}

            {mode === 'paste' ? (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-400">
                        Paste markdown with YAML frontmatter
                    </label>
                    <textarea
                        value={pasteContent}
                        onChange={handlePasteChange}
                        placeholder={`---
id: my-entry-slug
type: entry
topic: My Topic
---

Content here...`}
                        rows={12}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:border-blue-500 focus:outline-none"
                    />
                </div>
            ) : (
                <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                        dragActive
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-slate-600 hover:border-slate-500'
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
                        className="hidden"
                        id="file-input"
                    />
                    <label
                        htmlFor="file-input"
                        className="cursor-pointer"
                    >
                        <div className="text-slate-400 mb-2">
                            {file ? (
                                <span className="text-slate-200">{file.name}</span>
                            ) : (
                                <>Drop a markdown file here or <span className="text-blue-400 underline">browse</span></>
                            )}
                        </div>
                        <p className="text-xs text-slate-500">
                            Expects YAML frontmatter with id, type, topic fields
                        </p>
                    </label>
                </div>
            )}

            {preview && (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-slate-200">Preview</h2>
                    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-slate-400">ID:</span>{' '}
                                <span className="text-slate-100">{preview.frontmatter.id}</span>
                            </div>
                            <div>
                                <span className="text-slate-400">Type:</span>{' '}
                                <span className="text-slate-100">{preview.frontmatter.type}</span>
                            </div>
                            <div>
                                <span className="text-slate-400">Topic:</span>{' '}
                                <span className="text-slate-100">{preview.frontmatter.topic || '(not set)'}</span>
                            </div>
                            <div>
                                <span className="text-slate-400">Status:</span>{' '}
                                <span className="text-slate-100">{preview.frontmatter.status || 'active'}</span>
                            </div>
                        </div>
                        {preview.content && (
                            <div>
                                <span className="text-slate-400 text-sm">Content preview:</span>
                                <pre className="mt-1 text-xs text-slate-300 bg-slate-900 p-2 rounded max-h-40 overflow-auto">
                                    {preview.content.slice(0, 500)}{preview.content.length > 500 ? '...' : ''}
                                </pre>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm"
                        >
                            {loading ? 'Creating...' : 'Create Entry'}
                        </button>
                        <button
                            type="button"
                            onClick={clearAll}
                            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="text-sm text-slate-500 space-y-2">
                <p className="font-medium text-slate-400">Expected format:</p>
                <pre className="bg-slate-800 p-3 rounded text-xs overflow-auto">{`---
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
