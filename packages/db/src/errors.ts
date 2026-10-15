export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class ApprovalError extends Error {
  constructor(
    public readonly code: 'not_pending' | 'expired' | 'hash_mismatch' | 'nonce_mismatch' | 'not_approved' | 'already_consumed' | 'tampered',
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}
