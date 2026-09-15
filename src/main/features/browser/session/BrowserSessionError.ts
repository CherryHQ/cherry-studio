import type { BrowserDialog } from '../browserUse'

export class BrowserSessionError extends Error {
  constructor(
    readonly code:
      | 'stale_ref'
      | 'dialog_open'
      | 'timeout'
      | 'debugger_unavailable'
      | 'not_allowed'
      | 'budget_exceeded'
      | 'not_found'
      | 'occluded',
    readonly dialog?: BrowserDialog
  ) {
    super(code)
    this.name = 'BrowserSessionError'
  }
}
