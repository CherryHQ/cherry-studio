import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import type { SnapshotRound } from '@main/ai/agentSession/AgentFileSnapshotService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'

// Only deny here: allowing would bypass the SDK's normal permission checks.
const logger = loggerService.withContext('ClaudeCodeFileWriteSnapshot')
const tools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const denial = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
})

export function createFileWriteSnapshotHooks(
  sessionId: string,
  cwd: string
): { pre: HookCallback; post: HookCallback } {
  const attempts = new Map<string, { attemptId: string; round: SnapshotRound }>()
  const fileSnapshotPreHook: HookCallback = async (input, callId, options) => {
    if (input.hook_event_name !== 'PreToolUse' || !tools.has(input.tool_name)) return {}
    let protectedAttempt: { attemptId: string; round: SnapshotRound } | undefined
    const denyProtected = async (reason: string) => {
      if (protectedAttempt) {
        try {
          await application.get('AgentFileSnapshotService').settleWrite({ ...protectedAttempt, outcome: 'cancelled' })
        } catch (error) {
          logger.error('Failed to settle denied file write', { error })
        }
      }
      return denial(reason)
    }
    try {
      if (!sessionId || !cwd || !callId) return denial('stale')
      const toolInput = input.tool_input as Record<string, unknown>
      const filePath = toolInput?.[input.tool_name === 'NotebookEdit' ? 'notebook_path' : 'file_path']
      if (typeof filePath !== 'string' || !filePath) return {}
      const target = path.resolve(cwd, filePath)
      const relative = path.relative(path.resolve(cwd), target)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return {}
      const runtime = application.get('AgentSessionRuntimeService')
      const round = runtime.getLiveSnapshotRound(sessionId)
      if (!round?.replyId) return denial('stale')
      let attemptId: string
      let classification: 'none' | 'empty' | 'large-deletion' | 'undecidable'
      try {
        ;({ attemptId, classification } = await application.get('AgentFileSnapshotService').protectWrite({
          round,
          callId,
          runtime: 'claude-code',
          toolName: input.tool_name,
          filePath: target,
          cwd,
          intent: { toolName: input.tool_name, input: toolInput }
        }))
      } catch (error) {
        logger.error('Failed to save file snapshot', { error })
        return denial(
          (error as NodeJS.ErrnoException | null)?.code === 'SNAPSHOT_ROOT_IN_WORKSPACE'
            ? 'SNAPSHOT_ROOT_IN_WORKSPACE'
            : 'snapshot-failed'
        )
      }
      protectedAttempt = { attemptId, round }
      if (classification !== 'none') {
        const interaction = runtime.getInteractionState(sessionId)
        const emit = application.get('ClaudeCodeSessionStateService').peekToolApprovalEmitter(sessionId)?.emit
        if (interaction.currentTurn !== 'interactive' || interaction.userResponse === 'unavailable' || !emit)
          return await denyProtected('approval-unavailable')
        const approved = await new Promise<boolean>((resolve) => {
          const approvalId = randomUUID()
          const controller = new AbortController()
          const abort = () => controller.abort()
          options.signal.addEventListener('abort', abort, { once: true })
          if (options.signal.aborted) controller.abort()
          const timer = setTimeout(abort, 60_000)
          const presentation = interaction.userResponse === 'stream' ? 'stream' : 'message'
          const pending = toolApprovalRegistry.register({
            approvalId,
            sessionId,
            toolCallId: callId,
            toolName: input.tool_name,
            originalInput: toolInput,
            presentation,
            signal: controller.signal,
            resolve: (decision) => {
              clearTimeout(timer)
              options.signal.removeEventListener('abort', abort)
              resolve(
                decision.approved &&
                  (!decision.updatedInput || JSON.stringify(decision.updatedInput) === JSON.stringify(toolInput)) &&
                  !controller.signal.aborted
              )
            }
          })
          if (pending) {
            try {
              emit({ approvalId, toolCallId: callId, toolName: input.tool_name, input: toolInput, presentation })
            } catch {
              controller.abort()
            }
          }
        })
        if (!approved || runtime.getLiveSnapshotRound(sessionId)?.replyId !== round.replyId)
          return await denyProtected('approval-denied')
      }
      attempts.set(callId, { attemptId, round })
      return {}
    } catch (error) {
      logger.error('File snapshot hook failed', { error })
      return await denyProtected('snapshot-failed')
    }
  }
  const fileSnapshotPostHook: HookCallback = async (input, callId) => {
    if (
      (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure') ||
      !tools.has(input.tool_name) ||
      !callId
    )
      return {}
    const attempt = attempts.get(callId)
    if (!attempt) return {}
    attempts.delete(callId)
    try {
      await application.get('AgentFileSnapshotService').settleWrite({
        round: attempt.round,
        attemptId: attempt.attemptId,
        outcome: input.hook_event_name === 'PostToolUse' ? 'success' : 'failure'
      })
    } catch (error) {
      logger.error('Failed to settle file snapshot', { error })
    }
    return {}
  }
  return { pre: fileSnapshotPreHook, post: fileSnapshotPostHook }
}
