import { useState } from 'react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { AlertBox } from '../molecules/AlertBox';

interface ConflictBannerProps {
  expectedTargetRevision: number | null;
  currentTargetRevision: number | null;
  onReloadCurrent: () => void;
  onCreateRefreshAmendment: (note: string) => Promise<void> | void;
}

/**
 * Visible stale-revision recovery: the namespace moved past the version this
 * proposal was reviewed against. Never auto-replays accept -- the reviewer
 * must explicitly reload the new diff or persist an empty-patch "refresh"
 * amendment against the new current revision before accepting again.
 */
export function ConflictBanner({ expectedTargetRevision, currentTargetRevision, onReloadCurrent, onCreateRefreshAmendment }: ConflictBannerProps) {
  const [showRefreshForm, setShowRefreshForm] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRefresh = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      await onCreateRefreshAmendment(note.trim());
      setShowRefreshForm(false);
      setNote('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertBox variant="warning" title="This proposal's target revision is stale">
      <p>
        Expected target revision <span className="font-mono">{expectedTargetRevision ?? 'none'}</span>, but the namespace is now at{' '}
        <span className="font-mono">{currentTargetRevision ?? 'unknown'}</span>. Accept is disabled until you reload the current diff or persist a refresh amendment.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onReloadCurrent}>
          Reload current
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowRefreshForm((v) => !v)}>
          Create refresh amendment
        </Button>
      </div>
      {showRefreshForm && (
        <div className="mt-3 space-y-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required note for this refresh amendment" />
          <Button variant="primary" size="sm" onClick={handleRefresh} disabled={!note.trim() || submitting} loading={submitting}>
            Persist refresh amendment
          </Button>
        </div>
      )}
    </AlertBox>
  );
}
