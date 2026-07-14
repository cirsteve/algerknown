export class ProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`proposal "${proposalId}" not found`);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalInvalidTransitionError extends Error {
  constructor(proposalId: string, from: string, action: string) {
    super(`proposal "${proposalId}" cannot ${action} from status "${from}"`);
    this.name = 'ProposalInvalidTransitionError';
  }
}

export class ProposalVersionConflictError extends Error {
  constructor(proposalId: string, expected: number, actual: number) {
    super(`proposal "${proposalId}" version conflict: expected ${expected}, found ${actual}`);
    this.name = 'ProposalVersionConflictError';
  }
}

export class ProposalIdempotencyMismatchError extends Error {
  constructor(scope: string, key: string) {
    super(`idempotency key "${key}" in scope "${scope}" was reused with different request content`);
    this.name = 'ProposalIdempotencyMismatchError';
  }
}

export class ProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalValidationError';
  }
}

export class ProposalAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalAttestationError';
  }
}
