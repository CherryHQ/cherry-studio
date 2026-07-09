import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

/**
 * Identity seed for the builtin Cherry Assistant DB row.
 * Runtime behavior (localized instructions/description and bundled skills) lives in
 * resources/builtin-agents/cherry-assistant/agent.json and is resolved at session build time.
 */
export const CHERRY_ASSISTANT_SEED = {
  name: 'Cherry Assistant',
  configuration: {
    avatar: '🍒',
    permission_mode: 'default',
    max_turns: 100,
    env_vars: {},
    builtin_role: 'assistant'
  } satisfies AgentConfiguration
} as const
