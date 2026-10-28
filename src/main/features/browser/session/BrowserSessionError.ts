import type { BrowserDialog } from '../browserUse'

export class BrowserSessionError extends Error {
  constructor(
    readonly code:
      | 'stale_web_tool'
      | 'webmcp_unsupported'
      | 'unsupported_web_tool'
      | 'invalid_tool_input'
      | 'web_tool_failed'
      | 'web_tool_canceled'
      | 'stale_ref'
      | 'dialog_open'
      | 'timeout'
      | 'debugger_unavailable'
      | 'not_allowed'
      | 'budget_exceeded'
      | 'input_not_focused'
      | 'not_found'
      | 'occluded',
    readonly dialog?: BrowserDialog
  ) {
    super(
      code === 'input_not_focused'
        ? 'Browser input stopped because the page or target field does not have input focus. Bring the browser pane into view and focus it, then inspect the page before retrying; earlier input may already have been applied.'
        : code
    )
    this.name = 'BrowserSessionError'
  }
}
