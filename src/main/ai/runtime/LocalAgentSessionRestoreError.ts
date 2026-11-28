export class LocalAgentSessionRestoreError extends Error {
  static readonly errorName = 'LocalAgentSessionRestoreError'

  override name = LocalAgentSessionRestoreError.errorName
}
