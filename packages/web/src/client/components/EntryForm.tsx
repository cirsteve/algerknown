import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Since we can't easily import types from core in the frontend without build config issues sometimes,
// we'll define a subset or use 'any' for the form state temporarily or duplicate the type.
// For now, let's look at what AnyEntry is.
// It seems to have id, type, topic, etc.

interface EntryFormProps {
    initialData?: any; // TODO: Replace 'any' with a stricter type once shared entry types are available to the frontend.
    onSubmit: (data: any) => Promise<void>;
    submitLabel: string;
}

export function EntryForm({ initialData, onSubmit, submitLabel }: EntryFormProps) {
    const navigate = useNavigate();
    const [formData, setFormData] = useState<any>({
        type: 'entry',
        status: 'active',
        topic: '',
        id: '',
        ...initialData,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // When editing, the ID field is expected to remain immutable in file-based systems unless the underlying file is moved.
    // TODO: Confirm and document the expected backend PUT behavior for IDs in path parameters versus the request body.
    const isEditing = !!initialData;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev: any) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await onSubmit(formData);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            {error && (
                <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Type</label>
                    <select
                        name="type"
                        value={formData.type}
                        onChange={handleChange}
                        disabled={isEditing}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 disabled:opacity-50"
                    >
                        <option value="entry">Entry</option>
                        <option value="summary">Summary</option>
                    </select>
                </div>

                {/* Status */}
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                    <select
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                    >
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                    </select>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">ID</label>
                <input
                    type="text"
                    name="id"
                    value={formData.id}
                    onChange={handleChange}
                    disabled={isEditing}
                    placeholder="entry-slug-or-date"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 disabled:opacity-50"
                    required
                />
                {!isEditing && <p className="text-xs text-slate-500 mt-1">Unique identifier (slug)</p>}
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Topic</label>
                <input
                    type="text"
                    name="topic"
                    value={formData.topic || ''}
                    onChange={handleChange}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                    required
                />
            </div>

            {/* Dynamic Fields based on Type? For now just generic Text Areas or JSON editors for flexibility?
          Let's stick to simple textarea fields for specific standard properties like 'context', 'content', 'summary'.
       */}

            {formData.type === 'summary' ? (
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Summary Content</label>
                    <textarea
                        name="summary"
                        value={formData.summary || ''}
                        onChange={handleChange}
                        rows={5}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm"
                    />
                </div>
            ) : (
                // Entry fields
                <>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Context</label>
                        <textarea
                            name="context"
                            value={formData.context || ''}
                            onChange={handleChange}
                            rows={3}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Approach</label>
                        <textarea
                            name="approach"
                            value={formData.approach || ''}
                            onChange={handleChange}
                            rows={3}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                        />
                    </div>
                </>
            )}

            {/* Tags (comma separated) */}
            <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Tags</label>
                <input
                    type="text"
                    name="tagsStr" // We'll handle split on submit or simple string for now
                    value={Array.isArray(formData.tags) ? formData.tags.join(', ') : (formData.tags || '')}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="react, typescript, api"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                />
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 text-slate-300 hover:text-white"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50"
                >
                    {loading ? 'Saving...' : submitLabel}
                </button>
            </div>
        </form>
    );
}
