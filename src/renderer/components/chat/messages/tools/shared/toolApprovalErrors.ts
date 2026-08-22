/**
 * Thrown when a tool-approval decision cannot be delivered because its approval channel is
 * gone — the asking turn aborted or the session restarted, so neither the live approval
 * registry nor a resumable anchor exists. Unlike a transient send failure, retrying can
 * never succeed; composers surface this with accurate copy instead of a "please retry" toast.
 */
export class StaleApprovalError extends Error {
  constructor(message = 'Tool approval response was not accepted: its approval channel is gone') {
    super(message)
    this.name = 'StaleApprovalError'
  }
}
