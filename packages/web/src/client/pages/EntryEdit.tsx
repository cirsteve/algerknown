import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { parseContent } from '../lib/parseContent';
import { AlertBox } from '../components/molecules/AlertBox';
import * as yaml from 'yaml';

const fieldStyles =
    'w-full rounded-lg border border-edge bg-surface-raised text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

const secondaryButton =
    'rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

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

    if (loading) return <div className="text-content-muted">Loading...</div>;

    if (error && !entry) {
        return (
            <div className="min-w-0 space-y-4">
                <Link
                    to="/entries"
                    className="rounded-sm text-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    ← Back to entries
                </Link>
                <AlertBox variant="error">
                    <span className="block break-words">Failed to load entry: {error}</span>
                </AlertBox>
            </div>
        );
    }

    return (
        <div className="min-w-0 space-y-6">
            {/* The id is unbroken text, so it moves under the title rather than
                competing with it for the row at 320px. */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <h1 className="text-xl font-bold text-content-strong sm:text-2xl">Edit Entry</h1>
                <span className="break-all font-mono text-sm text-content-muted">{id}</span>
            </div>

            {error && (
                <AlertBox variant="error">
                    <span className="block break-words">{error}</span>
                </AlertBox>
            )}

            <div className="space-y-2">
                <label htmlFor="entry-yaml" className="block text-sm font-medium text-content-muted">
                    Edit YAML
                </label>
                <textarea
                    id="entry-yaml"
                    value={yamlContent}
                    onChange={handleYamlChange}
                    rows={20}
                    className={`${fieldStyles} px-3 py-2 font-mono text-sm`}
                />
            </div>

            {preview && (
                <div className="min-w-0 space-y-4">
                    <h2 className="text-lg font-semibold text-content-strong">Preview</h2>
                    <div className="min-w-0 space-y-3 rounded-lg border border-edge bg-surface-raised p-4">
                        {/* Two columns of label/value need about 20rem; below `sm`
                            they stack so neither value is clipped. */}
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
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-3">
                <button
                    onClick={handleSubmit}
                    disabled={saving || !preview}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" onClick={handleReset} className={secondaryButton}>
                    Reset
                </button>
                <button type="button" onClick={() => navigate(`/entries/${id}`)} className={secondaryButton}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
