import { loggerService } from '@logger'
import type { ModelMessage, Tool } from 'ai'

const logger = loggerService.withContext('isApprovalGated')

export interface ApprovalGateOptions {
  /** The tool input, for an input-dependent `needsApproval`. Omitted at defer build time. */
  input?: unknown
  toolCallId?: string
  messages?: ModelMessage[]
  experimental_context?: unknown
}

/**
 * Whether `tool` would require user approval before executing — the gate the AI SDK enforces
 * natively for tools it dispatches itself (`needsApproval`). Cherry must evaluate it explicitly
 * wherever a registry tool runs OUTSIDE that native dispatch (the `tool_invoke` / `tool_exec`
 * meta-tools and defer-exposition), otherwise a deferred tool slips past the approval card.
 *
 * Fail-closed: an absent gate is `false`, but a throwing one returns `true` (treat as gated) so
 * a broken policy never silently auto-runs a tool.
 *
 * NOTE: defer build-time callers pass empty `input`, which is exact only while `needsApproval`
 * is input-independent (today's MCP source policy). The call-time guard in `tool_invoke`, which
 * passes the real input, is authoritative for any future input-dependent gate.
 */
export async function isApprovalGated(tool: Tool, opts: ApprovalGateOptions = {}): Promise<boolean> {
  const needsApproval = tool.needsApproval
  if (needsApproval === undefined) return false
  if (typeof needsApproval === 'boolean') return needsApproval
  try {
    return await needsApproval(opts.input, {
      toolCallId: opts.toolCallId ?? '',
      messages: opts.messages ?? [],
      experimental_context: opts.experimental_context
    })
  } catch (err) {
    logger.warn('needsApproval threw; treating tool as approval-gated', err as Error)
    return true
  }
}
