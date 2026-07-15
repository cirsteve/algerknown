export class KeychainOperationError extends Error {
  constructor(
    public readonly operation: 'get' | 'set' | 'delete',
    public readonly providerName: string,
    public readonly stderr: string,
  ) {
    super(`${providerName} keychain ${operation} failed: ${stderr.trim() || '(no error output)'}`);
    this.name = 'KeychainOperationError';
  }
}
