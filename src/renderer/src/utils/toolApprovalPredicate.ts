import { CLAUDE_AGENT_TRANSPORT } from '@renderer/pages/home/Messages/Tools/toolResponse'
import type { UIMessage } from 'ai'
import { isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'

/**
 * `sendAutomaticallyWhen` predicate:
 *  - MCP approvals → resend (the SDK re-runs the loop; `execute()` fires
 *    once it sees `approval-responded`).
 *  - Claude-Agent approvals → don't resend; the same in-flight stream is
 *    unblocked via `Ai_ToolApproval_Respond` IPC.
 */
export function cherryApprovalPredicate(options: { messages: UIMessage[] }): boolean {
  if (!lastAssistantMessageIsCompleteWithApprovalResponses(options)) return false

  for (let i = options.messages.length - 1; i >= 0; i--) {
    const message = options.messages[i]
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue
      const p = part as unknown as {
        state?: string
        providerMetadata?: { cherry?: { transport?: string } }
      }
      if (p.state === 'approval-responded' && p.providerMetadata?.cherry?.transport === CLAUDE_AGENT_TRANSPORT) {
        return false
      }
    }
    return true
  }
  return false
}
