import { useState } from 'react';
import { Button } from '../atoms/Button';
import { AlertBox } from '../molecules/AlertBox';
import { useProposalActions } from '../../hooks/useGovernance';
import { proposalCapabilities } from '../../lib/governanceCapabilities';
import { GovernanceApiError, type ProposalDetail } from '../../lib/governanceApi';
import { ActionDialog } from './ActionDialog';

type DialogKind = 'accept' | 'reject' | 'expire' | 'delete' | null;

interface ReviewActionsProps {
  proposal: ProposalDetail;
  onConflict: () => void;
}

/**
 * Accept/reject/expire/delete: every action requires a non-empty
 * note/reason, shows the exact loaded proposal version, and is only shown
 * when the (client-derived) capabilities permit it -- visibility is
 * advisory, the server remains authoritative.
 */
export function ReviewActions({ proposal, onConflict }: ReviewActionsProps) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const actions = useProposalActions(proposal.id);
  const capabilities = proposalCapabilities(proposal);

  const closeDialog = () => setDialog(null);

  const handleAccept = async (note: string, idempotencyKey: string) => {
    try {
      await actions.accept({ expectedVersion: proposal.version, expectedTargetRevision: proposal.expectedTargetRevision, reviewNote: note, idempotencyKey });
      setBanner('Proposal accepted.');
      closeDialog();
    } catch (err) {
      if (err instanceof GovernanceApiError && (err.code === 'version_conflict' || err.code === 'target_revision_conflict')) {
        onConflict();
        closeDialog();
        return;
      }
      throw err;
    }
  };

  const handleReject = async (reason: string, idempotencyKey: string) => {
    await actions.reject({ expectedVersion: proposal.version, reason, idempotencyKey });
    setBanner('Proposal rejected.');
    closeDialog();
  };

  const handleExpire = async (note: string, idempotencyKey: string) => {
    await actions.expire({ expectedVersion: proposal.version, note, idempotencyKey });
    setBanner('Proposal marked expired.');
    closeDialog();
  };

  const handleDelete = async (reason: string, idempotencyKey: string) => {
    await actions.delete({ expectedVersion: proposal.version, reason, idempotencyKey });
    setBanner('Proposal deleted.');
    closeDialog();
  };

  if (!capabilities.canAccept && !capabilities.canReject && !capabilities.canExpire && !capabilities.canDelete) {
    return banner ? <AlertBox variant="success">{banner}</AlertBox> : null;
  }

  return (
    <div className="space-y-3">
      {banner && <AlertBox variant="success">{banner}</AlertBox>}
      <div className="flex flex-wrap gap-2">
        {capabilities.canAccept && (
          <Button variant="success" size="sm" onClick={() => setDialog('accept')}>
            Accept
          </Button>
        )}
        {capabilities.canReject && (
          <Button variant="danger" size="sm" onClick={() => setDialog('reject')}>
            Reject
          </Button>
        )}
        {capabilities.canExpire && (
          <Button variant="secondary" size="sm" onClick={() => setDialog('expire')}>
            Expire
          </Button>
        )}
        {capabilities.canDelete && (
          <Button variant="danger" size="sm" onClick={() => setDialog('delete')}>
            Delete
          </Button>
        )}
      </div>

      {dialog === 'accept' && (
        <ActionDialog
          title="Accept proposal"
          fieldLabel="Review note"
          proposalVersion={proposal.version}
          expectedTargetRevision={proposal.expectedTargetRevision}
          confirmLabel="Accept"
          variant="primary"
          onCancel={closeDialog}
          onConfirm={handleAccept}
        />
      )}
      {dialog === 'reject' && (
        <ActionDialog
          title="Reject proposal"
          fieldLabel="Reason"
          proposalVersion={proposal.version}
          confirmLabel="Reject"
          variant="danger"
          onCancel={closeDialog}
          onConfirm={handleReject}
        />
      )}
      {dialog === 'expire' && (
        <ActionDialog
          title="Mark proposal expired"
          fieldLabel="Note"
          proposalVersion={proposal.version}
          confirmLabel="Expire"
          variant="primary"
          onCancel={closeDialog}
          onConfirm={handleExpire}
        />
      )}
      {dialog === 'delete' && (
        <ActionDialog
          title="Delete proposal"
          fieldLabel="Reason"
          proposalVersion={proposal.version}
          confirmLabel="Delete"
          variant="danger"
          onCancel={closeDialog}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
