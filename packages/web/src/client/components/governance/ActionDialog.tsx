import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button';
import { TextArea } from '../atoms/Input';
import { newIdempotencyKey } from '../../lib/governanceApi';

interface ActionDialogProps {
  title: string;
  fieldLabel: string;
  proposalVersion: number;
  expectedTargetRevision?: number | null;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  onCancel: () => void;
  onConfirm: (value: string, idempotencyKey: string) => Promise<void>;
  children?: ReactNode;
}

/**
 * Shared shape for every reasoned lifecycle action: a required non-empty
 * note/reason, the exact loaded proposal version (and target revision, when
 * relevant) surfaced so the reviewer can see what they're about to commit
 * against, and the submit button disabled while the request is outstanding.
 */
export function ActionDialog({ title, fieldLabel, proposalVersion, expectedTargetRevision, confirmLabel, variant = 'primary', onCancel, onConfirm, children }: ActionDialogProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per distinct (trimmed) note/reason: repeated clicks/retries of
  // an unchanged intent reuse it; editing the text is a content change and
  // gets a fresh one, per the idempotency-key policy for review actions.
  const trimmed = value.trim();
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [trimmed]);

  const handleConfirm = async () => {
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed, idempotencyKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 space-y-4" role="dialog" aria-modal="true">
        <h2 className={`text-xl font-bold ${variant === 'danger' ? 'text-red-400' : 'text-slate-200'}`}>{title}</h2>
        <div className="text-xs text-slate-500">
          Proposal version <span className="font-mono text-slate-300">{proposalVersion}</span>
          {expectedTargetRevision !== undefined && (
            <>
              {' '}
              · expected target revision <span className="font-mono text-slate-300">{expectedTargetRevision ?? 'none'}</span>
            </>
          )}
        </div>
        {children}
        <div>
          <label htmlFor="action-dialog-field" className="block text-sm text-slate-400 mb-1">
            {fieldLabel} (required)
          </label>
          <TextArea id="action-dialog-field" value={value} onChange={(e) => setValue(e.target.value)} rows={3} autoFocus />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={handleConfirm} disabled={!value.trim() || submitting} loading={submitting}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
