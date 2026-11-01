import type { HookCallback, HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'

import { PromptBuilder } from '@main/ai/agents/prompt'

/** Per-connection identity delivery; SessionStart also runs after native context compaction. */
export function createClaudeCodeIdentityHooks(
  agentDataPath: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const builder = new PromptBuilder()
  let delivered: string | undefined
  const refresh: HookCallback = async (input, _toolUseId, { signal }) => {
    if (input.hook_event_name !== 'SessionStart' && input.hook_event_name !== 'UserPromptSubmit') return {}
    if (input.agent_id || signal.aborted) return {}
    const snapshot = await builder.buildMemoriesSection(agentDataPath)
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
