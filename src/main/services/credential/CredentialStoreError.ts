export type CredentialStoreErrorCode =
  | 'invalid'
  | 'missing'
  | 'corrupt'
  | 'unreadable'
  | 'write-failed'
  | 'conflict'
  | 'in-use'
  | 'stopped'

export class CredentialStoreError extends Error {
  constructor(readonly code: CredentialStoreErrorCode) {
    super(`Credential operation failed: ${code}`)
    this.name = 'CredentialStoreError'
  }
}
