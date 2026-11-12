import type { HookCallback, HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { agentMemoryReference } from '@main/ai/memory/memoryPrompt'
import { openRuntimeMemoryGuard } from '@main/ai/memory/memoryRuntime'

/** Per-connection identity delivery; SessionStart also runs after native context compaction. */
export function createClaudeCodeIdentityHooks(
  agentDataPath: string,
  sessionId?: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const builder = new PromptBuilder()
  let delivered: string | undefined
  const refresh: HookCallback = async (input, _toolUseId, { signal }) => {
    if (input.hook_event_name !== 'SessionStart' && input.hook_event_name !== 'UserPromptSubmit') return {}
    if (input.agent_id || signal.aborted) return {}
    if (sessionId) {
      let guard: ReturnType<typeof openRuntimeMemoryGuard> | undefined
      try {
        guard = openRuntimeMemoryGuard(sessionId, () => {})
        await guard.check()
      } catch {
        return { continue: false, stopReason: 'Memory history requires isolation before this session can continue' }
      } finally {
        guard?.dispose()
      }
    }
    const migrated = sessionId ? await application.get('MemoryMigrationService').ensureSession(sessionId) : false
    const sections = await Promise.all([
      builder.buildMemoriesSection(agentDataPath, !migrated),
      sessionId
        ? agentMemoryReference(
            sessionId,
            () => application.get('AgentSessionRuntimeService').getInteractionState(sessionId),
            signal
          )
        : undefined
    ])
    const snapshot = sections.filter(Boolean).join('\n\n')
    if (signal.aborted) return {}
    if (input.hook_event_name === 'UserPromptSubmit' && snapshot === delivered) return {}
    delivered = snapshot
    return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: snapshot } }
  }
  return {
    SessionStart: [{ hooks: [refresh] }],
    UserPromptSubmit: [{ hooks: [refresh] }]
  }
}
