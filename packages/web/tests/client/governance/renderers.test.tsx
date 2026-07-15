import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposalRenderer, resolveAdapterKind } from '../../../src/client/components/governance/renderers/registry';
import { pendingProposalDetail } from '../fixtures/proposal';

describe('resolveAdapterKind', () => {
  it('maps memory.* to summary and canonical.* to dossier', () => {
    expect(resolveAdapterKind('memory.project.demo')).toBe('summary');
    expect(resolveAdapterKind('canonical.project.demo')).toBe('dossier');
    expect(resolveAdapterKind('operation.audit')).toBe('generic');
  });
});

describe('ProposalRenderer', () => {
  it('renders the Summary adapter for a memory.* proposal, reconstructing learnings/decisions from recordKind', () => {
    render(<ProposalRenderer namespace={pendingProposalDetail.targetNamespace} mutation={pendingProposalDetail.canonicalMutation} />);

    expect(screen.getByText('New learnings')).toBeInTheDocument();
    expect(screen.getByText('The demo pipeline is fast.')).toBeInTheDocument();
    expect(screen.getByText('New decisions')).toBeInTheDocument();
    expect(screen.getByText('Use the demo pipeline.')).toBeInTheDocument();
  });

  it('renders nothing for a generic namespace', () => {
    const { container } = render(<ProposalRenderer namespace="operation.audit" mutation={pendingProposalDetail.canonicalMutation} />);
    expect(container).toBeEmptyDOMElement();
  });
});
