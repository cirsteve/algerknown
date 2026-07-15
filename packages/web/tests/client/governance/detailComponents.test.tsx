import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeEdgeDiff } from '../../../src/client/components/governance/NodeEdgeDiff';
import { ProvenancePanel } from '../../../src/client/components/governance/ProvenancePanel';
import { SupportingEvidence } from '../../../src/client/components/governance/SupportingEvidence';
import { RailVerdicts } from '../../../src/client/components/governance/RailVerdicts';
import { ConflictBanner } from '../../../src/client/components/governance/ConflictBanner';
import { pendingProposalDetail } from '../fixtures/proposal';

describe('NodeEdgeDiff', () => {
  it('renders every node and edge mutation with its op and a history link when available', () => {
    render(<NodeEdgeDiff mutation={pendingProposalDetail.canonicalMutation} historyHrefFor={(id) => `/entries/demo-dossier?node=${id}`} />);

    expect(screen.getByText('The demo pipeline is fast.')).toBeInTheDocument();
    expect(screen.getByText('Use the demo pipeline.')).toBeInTheDocument();
    expect(screen.getAllByText('create')).toHaveLength(5); // 3 node creates + 2 edge creates
    const historyLinks = screen.getAllByText('history');
    expect(historyLinks.length).toBeGreaterThan(0);
    expect(historyLinks[0]).toHaveAttribute('href', expect.stringContaining('node='));
  });
});

describe('ProvenancePanel', () => {
  it('renders rail, processor, sources, and mutation identity', () => {
    render(<ProvenancePanel provenance={pendingProposalDetail.provenance} mutationHash={pendingProposalDetail.mutationHash} fingerprint={pendingProposalDetail.fingerprint} />);

    expect(screen.getByText('rail: human-gated')).toBeInTheDocument();
    expect(screen.getByText('processor: rag-processor')).toBeInTheDocument();
    expect(screen.getByText(/entries\/entry-1\.yaml/)).toBeInTheDocument();
    expect(screen.getByText('hash-abc')).toBeInTheDocument();
  });
});

describe('SupportingEvidence', () => {
  it('lists supporting observations and derived_from edges', () => {
    render(
      <SupportingEvidence
        supportingObservationIds={pendingProposalDetail.supportingObservationIds}
        edgeMutations={pendingProposalDetail.canonicalMutation.edgeMutations}
      />,
    );

    expect(screen.getByText('entry-observation:entry-1')).toBeInTheDocument();
    expect(screen.getAllByText('derived_from')).toHaveLength(2);
  });
});

describe('RailVerdicts', () => {
  it('renders every evaluator verdict with a human-readable reason when failed', () => {
    render(
      <RailVerdicts
        verdicts={[
          { evaluator: 'contradiction', passed: false, reasonCodes: ['CONTRADICTION_DETECTED'] },
          { evaluator: 'schema-type', passed: true, reasonCodes: [] },
        ]}
      />,
    );

    expect(screen.getByText('contradiction')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText(/higher-confidence existing node contradicts/i)).toBeInTheDocument();
    expect(screen.getByText('schema-type')).toBeInTheDocument();
  });
});

describe('ConflictBanner', () => {
  it('shows expected vs current revision and requires a note before refreshing', async () => {
    const onReloadCurrent = vi.fn();
    const onCreateRefreshAmendment = vi.fn();
    render(<ConflictBanner expectedTargetRevision={3} currentTargetRevision={5} onReloadCurrent={onReloadCurrent} onCreateRefreshAmendment={onCreateRefreshAmendment} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reload current' }));
    expect(onReloadCurrent).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Create refresh amendment' }));
    const submit = screen.getByRole('button', { name: 'Persist refresh amendment' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/Required note/i), 'Refreshing against new revision');
    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);
    expect(onCreateRefreshAmendment).toHaveBeenCalledWith('Refreshing against new revision');
  });
});
