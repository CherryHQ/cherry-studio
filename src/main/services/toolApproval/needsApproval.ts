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
 * Keeps the per-tool wiring to a single line; the centralized policy
 * still lives in `services/toolApproval/checkPermission.ts`.
 */

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
    return decision.behavior === 'ask'
  }
}
