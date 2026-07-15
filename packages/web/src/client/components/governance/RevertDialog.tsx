import { useState } from 'react';
import { Button } from '../atoms/Button';
import { AlertBox } from '../molecules/AlertBox';
import { useProposalActions } from '../../hooks/useGovernance';
import { GovernanceApiError } from '../../lib/governanceApi';
import { ActionDialog } from './ActionDialog';

interface RevertDialogProps {
  proposalId: string;
  proposalVersion: number;
  resultingRevision: number;
  onReverted: (newRevision: number) => void;
}

/**
 * Authorized revert: reason required, sends only proposal id (via the
 * hook), reason, and idempotency key -- the server derives the target
 * revision from the proposal's own resultingRevision. Meant to be usable
 * from both an accepted proposal's history and its linked governed
 * revision detail (ChangesPage), so it owns no queue/detail-page state.
 */
export function RevertDialog({ proposalId, proposalVersion, resultingRevision, onReverted }: RevertDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = useProposalActions(proposalId);

  const handleRevert = async (reason: string, idempotencyKey: string) => {
    try {
      const outcome = await actions.revert({ reason, idempotencyKey });
      setOpen(false);
      onReverted(outcome.newRevision);
    } catch (err) {
      if (err instanceof GovernanceApiError && err.code === 'target_revision_conflict') {
        setError('The namespace moved since this proposal was accepted. Reload before reverting.');
        setOpen(false);
        return;
      }
      throw err;
    }
  };

  return (
    <div className="space-y-2">
      {error && <AlertBox variant="error">{error}</AlertBox>}
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Revert revision {resultingRevision}
      </Button>
      {open && (
        <ActionDialog
          title={`Revert revision ${resultingRevision}`}
          fieldLabel="Reason"
          proposalVersion={proposalVersion}
          confirmLabel="Revert"
          variant="danger"
          onCancel={() => setOpen(false)}
          onConfirm={handleRevert}
        />
      )}
    </div>
  );
}
