import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { TextArea } from '../atoms/Input';
import { AlertBox } from '../molecules/AlertBox';
import { useProposalActions } from '../../hooks/useGovernance';
import { newIdempotencyKey, type NodeMutation, type ProposalDetail } from '../../lib/governanceApi';
import { buildAmendmentPatch, cloneEditableMutations, removeMutationById, updateNodePayloadField, type EditableMutations } from '../../lib/governanceAmend';

/** The only fields the editor renders inputs for -- the de facto editable-path allowlist (see governanceAmend.ts). */
const EDITABLE_FIELDS_BY_NODE_TYPE: Record<string, string[]> = {
  observation: ['description'],
  decision: ['statement', 'rationale'],
};

interface AmendmentEditorProps {
  proposal: ProposalDetail;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * Inline draft-then-persist amendment editor. Editing/removing only ever
 * touches a local draft; "Save amendment" computes an RFC 6902 patch against
 * the loaded proposal version and persists it as a new immutable version.
 * Nothing here is ever reused as an accept payload.
 */
export function AmendmentEditor({ proposal, onDirtyChange }: AmendmentEditorProps) {
  const original = useMemo<EditableMutations>(
    () => ({ nodeMutations: proposal.canonicalMutation.nodeMutations, edgeMutations: proposal.canonicalMutation.edgeMutations }),
    [proposal.canonicalMutation],
  );
  const [draft, setDraft] = useState<EditableMutations | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = useProposalActions(proposal.id);

  const dirty = draft !== null;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const patch = draft ? buildAmendmentPatch(original, draft) : [];
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [JSON.stringify(patch)]);

  const startDraft = () => setDraft(cloneEditableMutations(original));

  const discardDraft = () => {
    if (dirty && !window.confirm('Discard unsaved amendment edits?')) return;
    setDraft(null);
    setNote('');
    setError(null);
  };

  const editField = (nodeId: string, field: string, value: string) => {
    setDraft((current) => (current ? updateNodePayloadField(current, nodeId, field, value) : current));
  };

  const removeNode = (nodeId: string) => {
    setDraft((current) => (current ? removeMutationById(current, nodeId) : current));
  };

  const save = async () => {
    if (!draft || !note.trim() || patch.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // POST /proposals/:id/amend currently accepts only expectedVersion,
      // patch, and idempotencyKey -- there is no request field for a note.
      // The note is still required here (a deliberate accountability gate
      // matching the reviewed decision) but is not yet persisted
      // server-side; the amendment's provenance is the version diff itself.
      await actions.amend({ expectedVersion: proposal.version, patch, idempotencyKey });
      setDraft(null);
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save amendment');
    } finally {
      setSaving(false);
    }
  };

  const createNodes = (draft ?? original).nodeMutations.filter((m): m is Extract<NodeMutation, { op: 'create' }> => m.op === 'create');

  if (!dirty) {
    return (
      <Button variant="secondary" size="sm" onClick={startDraft}>
        Edit / remove items
      </Button>
    );
  }

  return (
    <div className="space-y-3 border border-amber-700/50 rounded-lg p-4 bg-amber-900/10">
      <div className="flex items-center gap-2">
        <Badge variant="warning">unsaved draft</Badge>
        <span className="text-xs text-slate-400">Editing is local until you save an amendment.</span>
      </div>

      <ul className="space-y-2">
        {createNodes.map((node) => {
          const editableFields = EDITABLE_FIELDS_BY_NODE_TYPE[node.nodeType] ?? [];
          return (
            <li key={node.nodeId} className="bg-slate-900/50 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-sky-400">{node.nodeId}</span>
                <button type="button" onClick={() => removeNode(node.nodeId)} className="text-red-400 hover:text-red-300 text-sm">
                  Remove
                </button>
              </div>
              {editableFields.map((field) => {
                const fieldId = `amend-${node.nodeId}-${field}`;
                return (
                  <div key={field}>
                    <label htmlFor={fieldId} className="block text-xs text-slate-500 mb-1">
                      {field}
                    </label>
                    <TextArea
                      id={fieldId}
                      value={typeof node.payload[field] === 'string' ? (node.payload[field] as string) : ''}
                      onChange={(e) => editField(node.nodeId, field, e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>

      <div>
        <label htmlFor="amendment-note" className="block text-sm text-slate-400 mb-1">
          Amendment note (required)
        </label>
        <TextArea id="amendment-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>

      {error && <AlertBox variant="error">{error}</AlertBox>}

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={discardDraft} disabled={saving}>
          Discard
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={!note.trim() || patch.length === 0 || saving} loading={saving}>
          Save amendment
        </Button>
      </div>
    </div>
  );
}
