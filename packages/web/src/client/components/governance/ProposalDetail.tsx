import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../atoms/Badge';
import { LoadingState } from '../atoms/Spinner';
import { AlertBox } from '../molecules/AlertBox';
import { TabBar, Tab, TabPanel } from '../molecules/TabBar';
import { useProposalActions, useProposalDetail } from '../../hooks/useGovernance';
import { proposalCapabilities } from '../../lib/governanceCapabilities';
import { entryIdFromSubject, nodeHistoryHref } from '../../lib/governanceSubject';
import { newIdempotencyKey } from '../../lib/governanceApi';
import { ConflictBanner } from './ConflictBanner';
import { NodeEdgeDiff } from './NodeEdgeDiff';
import { ProvenancePanel } from './ProvenancePanel';
import { SupportingEvidence } from './SupportingEvidence';
import { RailVerdicts } from './RailVerdicts';
import { ReviewActions } from './ReviewActions';
import { AmendmentEditor } from './AmendmentEditor';
import { ProposalHistory } from './ProposalHistory';
import { RevertDialog } from './RevertDialog';
import { ProposalRenderer } from './renderers/registry';

type DetailTab = 'overview' | 'diff' | 'provenance' | 'history';

interface ProposalDetailProps {
  id: string;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * Complete proposal detail: every governance fact required by the phase is
 * inspectable before or after action. Polls are paused while an amendment
 * draft has unsaved changes so a background refresh can never overwrite it.
 */
export function ProposalDetail({ id, onDirtyChange }: ProposalDetailProps) {
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<DetailTab>('overview');
  const { proposal, error, mutate } = useProposalDetail(id, { paused: dirty });
  const actions = useProposalActions(id);

  const handleDirtyChange = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange(next);
    },
    [onDirtyChange],
  );

  // A new selection should never inherit a paused/dirty flag from the previous one.
  useEffect(() => {
    setDirty(false);
    onDirtyChange(false);
    setTab('overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <AlertBox variant="error">
        Failed to load proposal {id}: {error.message}
      </AlertBox>
    );
  }

  if (!proposal) {
    return <LoadingState message="Loading proposal..." />;
  }

  const capabilities = proposalCapabilities(proposal);
  const entryId = entryIdFromSubject(proposal.targetSubject);
  const historyHrefFor = (entityId: string) => nodeHistoryHref(entryId, proposal.targetNamespace, entityId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={proposal.status === 'pending' ? 'warning' : proposal.status === 'accepted' ? 'success' : 'default'}>{proposal.status}</Badge>
            <span className="text-xs text-slate-500">
              id {proposal.id} · v{proposal.version}
            </span>
          </div>
          <div className="font-mono text-sm text-sky-400 mt-1">{proposal.targetSubject}</div>
          <div className="text-xs text-slate-500">{proposal.targetNamespace}</div>
        </div>
        {proposal.resultingRevision !== null && (
          <Link
            to={`/changes?proposal=${encodeURIComponent(proposal.id)}&revision=${proposal.resultingRevision}`}
            className="text-sm text-sky-400 hover:text-sky-300 underline"
          >
            View resulting revision {proposal.resultingRevision} →
          </Link>
        )}
      </div>

      {proposal.conflict.stale && (
        <ConflictBanner
          expectedTargetRevision={proposal.expectedTargetRevision}
          currentTargetRevision={proposal.currentTargetRevision}
          onReloadCurrent={() => mutate()}
          onCreateRefreshAmendment={async (note) => {
            // POST /proposals/:id/amend only accepts a patch over
            // nodeMutations/edgeMutations -- expectedNamespaceRevision is
            // not an amendable path on the current API, so this empty-patch
            // amendment persists the reviewer's acknowledgement as a new
            // version (itself durable history) but cannot yet actually
            // re-anchor expectedTargetRevision to the new current revision.
            // The proposal will still show stale afterward; full recovery
            // requires the amend endpoint to expose that field, or
            // rejecting/expiring this proposal so the pipeline regenerates
            // a fresh one against the current revision.
            void note;
            await actions.amend({ expectedVersion: proposal.version, patch: [], idempotencyKey: newIdempotencyKey() });
            await mutate();
          }}
        />
      )}

      <TabBar>
        <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </Tab>
        <Tab active={tab === 'diff'} onClick={() => setTab('diff')}>
          Diff
        </Tab>
        <Tab active={tab === 'provenance'} onClick={() => setTab('provenance')}>
          Provenance &amp; verdicts
        </Tab>
        <Tab active={tab === 'history'} onClick={() => setTab('history')}>
          History
        </Tab>
      </TabBar>

      <TabPanel active={tab === 'overview'} className="space-y-4">
        <ProposalRenderer namespace={proposal.targetNamespace} mutation={proposal.canonicalMutation} />
        <ReviewActions proposal={proposal} onConflict={() => mutate()} />
        {capabilities.canAmend && <AmendmentEditor proposal={proposal} onDirtyChange={handleDirtyChange} />}
      </TabPanel>

      <TabPanel active={tab === 'diff'}>
        <NodeEdgeDiff mutation={proposal.canonicalMutation} historyHrefFor={historyHrefFor} />
      </TabPanel>

      <TabPanel active={tab === 'provenance'} className="space-y-6">
        <ProvenancePanel provenance={proposal.provenance} mutationHash={proposal.mutationHash} fingerprint={proposal.fingerprint} />
        <SupportingEvidence supportingObservationIds={proposal.supportingObservationIds} edgeMutations={proposal.canonicalMutation.edgeMutations} historyHrefFor={historyHrefFor} />
        <RailVerdicts verdicts={proposal.provenance.evaluatorVerdicts} />
      </TabPanel>

      <TabPanel active={tab === 'history'}>
        <ProposalHistory
          events={proposal.events}
          reversal={proposal.reversal}
          revertSlot={
            capabilities.canRevert && proposal.resultingRevision !== null ? (
              <RevertDialog proposalId={proposal.id} proposalVersion={proposal.version} resultingRevision={proposal.resultingRevision} onReverted={() => mutate()} />
            ) : undefined
          }
        />
      </TabPanel>
    </div>
  );
}
