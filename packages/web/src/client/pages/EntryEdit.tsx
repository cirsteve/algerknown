import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { parseContent } from '../lib/parseContent';
import * as yaml from 'yaml';

export function EntryEdit() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [entry, setEntry] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [yamlContent, setYamlContent] = useState('');
    const [preview, setPreview] = useState<{ frontmatter: any; content: string } | null>(null);

    useEffect(() => {
        async function load() {
            if (!id) return;
            try {
                const data = await api.getEntry(id);
                setEntry(data);
                // Convert to YAML for editing, separating content if present
                const { content, ...frontmatter } = data;
                if (content && typeof content === 'string' && content.trim()) {
                    // Format as markdown with frontmatter
                    setYamlContent(`---\n${yaml.stringify(frontmatter)}---\n\n${content}`);
                    setPreview({ frontmatter, content });
                } else {
                    setYamlContent(yaml.stringify(data));
                    setPreview({ frontmatter: data, content: '' });
                }
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id]);

    const handleYamlChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setYamlContent(text);
        setError(null);

        if (!text.trim()) {
            setPreview(null);
            return;
        }

        try {
            const parsed = parseContent(text);
            if (!parsed.frontmatter.id) {
                throw new Error('Must include "id" field');
            }
            setPreview(parsed);
        } catch (err) {
            setError((err as Error).message);
            setPreview(null);
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id || !preview) return;

        setSaving(true);
        setError(null);

        try {
            const updatedEntry = {
                ...preview.frontmatter,
                content: preview.content ?? preview.frontmatter.content,
            };
            await api.updateEntry(id, updatedEntry);
            navigate(`/entries/${id}`);
        } catch (err) {
            setError((err as Error).message);
            setSaving(false);
        }
    };

    const handleReset = () => {
        if (entry) {
            setYamlContent(yaml.stringify(entry));
            setPreview({ frontmatter: entry, content: '' });
            setError(null);
        }
    };

    if (loading) return <div className="text-slate-400">Loading...</div>;

    if (error && !entry) {
        return (
            <div className="space-y-4">
                <Link to="/entries" className="text-sky-400 hover:text-sky-300 text-sm">
                    ← Back to entries
                </Link>
                <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
                    Failed to load entry: {error}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-100">Edit Entry</h1>
                <span className="text-slate-400 text-sm font-mono">{id}</span>
            </div>

            {error && (
                <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
                    {error}
                </div>
            )}

            <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-400">
                    Edit YAML
                </label>
                <textarea
                    value={yamlContent}
                    onChange={handleYamlChange}
                    rows={20}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:border-blue-500 focus:outline-none"
                />
            </div>

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
                    </div>
                </div>
            )}

            <div className="flex gap-3">
                <button
                    onClick={handleSubmit}
                    disabled={saving || !preview}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm"
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
                >
                    Reset
                </button>
                <button
                    type="button"
                    onClick={() => navigate(`/entries/${id}`)}
                    className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
