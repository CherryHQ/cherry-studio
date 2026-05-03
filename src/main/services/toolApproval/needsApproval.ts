/**
 * Factory for AI SDK `needsApproval` callbacks that route through the
 * unified permission pipeline.
 *
 * Each builtin tool's `tool({...})` config calls this with its own name;
 * the returned callback runs `checkPermission`, then:
 *   - allow → resolves `false` (execute now)
 *   - deny  → throws (AI SDK reports tool error to the model)
 *   - ask   → resolves `true` (AI SDK suspends + emits approval-request)
 *
 * On 'ask' we stash the L3 hook's `suggestedRule` into the shared cache
 * under `tool_approval.suggested_rule.${toolCallId}`. The renderer's
 * approval card reads it via `useSharedCache` to populate the
 * "Allow always: <pattern>" affordance. The entry is cleared by the
 * `Ai_ToolApproval_Respond` IPC handler after dispatch.
 *
 * Keeps the per-tool wiring to a single line; the centralized policy
 * still lives in `services/toolApproval/checkPermission.ts`.
 */

import { application } from '@application'
import type { ToolExecutionOptions } from 'ai'

import { checkPermission } from './index'

type ToolKind = 'builtin' | 'mcp' | 'claude-agent'

export function makeNeedsApproval(
  toolName: string,
  opts: { toolKind?: ToolKind } = {}
): (input: unknown, sdkOpts: ToolExecutionOptions) => Promise<boolean> {
  const toolKind = opts.toolKind ?? 'builtin'
  return async (input, sdkOpts) => {
    const ctx = {
      toolKind,
      sessionId: sdkOpts.toolCallId,
      toolCallId: sdkOpts.toolCallId,
      cwd: typeof (input as { cwd?: unknown })?.cwd === 'string' ? (input as { cwd: string }).cwd : undefined,
      ...(sdkOpts.experimental_context as { topicId?: string; anchorId?: string } | undefined)
    }
    const decision = await checkPermission(toolName, input, ctx)
    if (decision.behavior === 'deny') {
      throw new Error(decision.reason ?? `${toolName} denied by permission policy.`)
    }
    if (decision.behavior === 'ask') {
      const cacheService = application.get('CacheService')
      cacheService.setShared(`tool_approval.suggested_rule.${sdkOpts.toolCallId}`, decision.suggestedRule ?? null)
      return true
    }
    return false
  }
}
