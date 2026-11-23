import type { AgentType } from '@shared/data/types/agent'

const shared = new Set([
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'CHERRY_STUDIO_NODE_PROXY_RULES',
  'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
  'CHERRY_STUDIO_BUN_PATH',
  'CHERRY_STUDIO_SKILLS_DIR',
  '__PROTO__',
  'CONSTRUCTOR',
  'PROTOTYPE'
])
const claude = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_AGENT_SDK_CLIENT_APP'
])
const pi = new Set(['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL'])

export const CLAUDE_EXTERNAL_CLI_REMOVED_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN'
]

export function isAgentEnvVarBlocked(runtime: AgentType, key: string): boolean {
  const normalized = key.toUpperCase()
  return (
    runtime === 'pi-durable' ||
    shared.has(normalized) ||
    (runtime === 'claude-code' && claude.has(normalized)) ||
    (runtime === 'pi' && pi.has(normalized))
  )
}

export function getIgnoredAgentEnvVarKeys(runtime: AgentType, keys: readonly string[], externalCli: boolean): string[] {
  return [
    ...new Set(
      keys.filter(
        (key) =>
          isAgentEnvVarBlocked(runtime, key) ||
          (runtime === 'claude-code' && externalCli && CLAUDE_EXTERNAL_CLI_REMOVED_ENV_KEYS.includes(key))
      )
    )
  ]
}
