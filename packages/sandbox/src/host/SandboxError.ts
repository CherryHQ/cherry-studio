export class SandboxError extends Error {
  constructor(
    readonly code:
      | 'INVALID_SPEC'
      | 'BACKEND_UNAVAILABLE'
      | 'SETUP_REQUIRED'
      | 'POLICY_UNSUPPORTED'
      | 'START_FAILED'
      | 'START_TIMEOUT'
      | 'CANCELLED'
      | 'LIMIT_EXCEEDED'
      | 'TERMINATION_UNCONFIRMED'
      | 'CLEANUP_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'SandboxError'
  }
}
