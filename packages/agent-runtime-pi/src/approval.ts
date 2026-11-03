/**
 * An approval event of one tool call, from the host's approval layer: `pending` while it waits for
 * the user, then how it ended. `unavailable`: nobody can approve (a channel or scheduled run).
 */
export interface ToolApprovalEvent {
  kind: 'pending' | 'granted' | 'denied' | 'unavailable'
  toolCallId: string
  /**
   * The Pi session the call runs in (`ctx.sessionManager.getSessionId()` in the approval extension;
   * a subagent's is its `sessionId`). Without it, sessions are told apart by call id alone.
   */
  sessionId?: string
}
