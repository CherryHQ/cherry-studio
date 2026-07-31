import { isWin } from '@main/constant'

const MANAGED_SHELL_ENV_KEYS = new Set([
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_USE_POWERSHELL_TOOL',
  'POWERSHELL_TELEMETRY_OPTOUT'
])

const BUN_OPTIONS_ENV_KEY = 'BUN_OPTIONS'

const APPLICATION_PROVIDED_CLAUDE_MODEL_SELECTOR_ENV_KEYS = new Set([
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL'
])

const SCRUBBED_CLAUDE_MODEL_SELECTOR_ENV_KEYS = new Set([
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL'
])

const MANAGED_CLAUDE_MODEL_SELECTOR_ENV_KEYS = new Set([
  ...APPLICATION_PROVIDED_CLAUDE_MODEL_SELECTOR_ENV_KEYS,
  ...SCRUBBED_CLAUDE_MODEL_SELECTOR_ENV_KEYS
])

// Canonical values written by ClaudeCodeService after the login environment is merged.
// Keep these values, but remove inherited casing variants that would alias them on Windows.
const APPLICATION_PROVIDED_CLAUDE_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CONFIG_DIR'
])

// Authentication and backend-selection inputs supported by the installed Claude native runtime.
// Cherry Studio never delegates these choices to the login shell or Agent configuration.
const SCRUBBED_CLAUDE_AUTH_AND_BACKEND_ENV_KEYS = new Set([
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_AUTH',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_API_KEY',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_IDENTITY_TOKEN',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_SCOPE',
  'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_WORKSPACE_ID',
  'CLAUDE_CODE_API_BASE_URL',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CLAUDE_CODE_HFI_BEARER_TOKEN',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR'
])

// Remote, bridge, and agent-proxy inputs form an alternate WebSocket/backend path in the native CLI.
// Cherry Studio does not use that path, so no part of it may be activated by inherited or Agent env.
const SCRUBBED_CLAUDE_REMOTE_ENV_KEYS = new Set([
  'AGENT_HTTP_PROXY',
  'AGENT_HTTPS_PROXY',
  'AGENT_NO_PROXY',
  'AGENT_PROXY_AUTH_TOKEN',
  'AGENT_PROXY_URL',
  'CCR_AGENT_PROXY_ENABLED',
  'CLAUDE_BRIDGE_BASE_URL',
  'CLAUDE_BRIDGE_OAUTH_TOKEN',
  'CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY',
  'CLAUDE_BRIDGE_REATTACH_SEQ',
  'CLAUDE_BRIDGE_REATTACH_SESSION',
  'CLAUDE_BRIDGE_SESSION_INGRESS_URL',
  'CLAUDE_BRIDGE_USE_CCR_V2',
  'CLAUDE_CODE_ENABLE_REMOTE_RECAP',
  'CLAUDE_CODE_FORCE_BRIDGE',
  'CLAUDE_CODE_MOCK_REMOTE_SETTINGS',
  'CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE',
  'CLAUDE_CODE_REMOTE_HERMETIC_MODE',
  'CLAUDE_CODE_REMOTE_MEMORY_DIR',
  'CLAUDE_CODE_REMOTE_RAW_EVENTS_FILE',
  'CLAUDE_CODE_REMOTE_SEND_KEEPALIVES',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_REMOTE_SETTINGS_PATH',
  'CLAUDE_CODE_REMOTE_SETTINGS_POLL_MS',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_USE_CCR_V2',
  'CLAUDE_SESSION_ID',
  'CLAUDE_SESSION_INGRESS_TOKEN_FILE',
  'SESSION_INGRESS_URL'
])

const SCRUBBED_CLAUDE_SHELL_ENV_KEYS = new Set(['CLAUDE_CODE_SHELL', 'CLAUDE_CODE_SHELL_PREFIX'])

const SCRUBBED_CLAUDE_ENV_KEYS = new Set([
  ...SCRUBBED_CLAUDE_AUTH_AND_BACKEND_ENV_KEYS,
  ...SCRUBBED_CLAUDE_REMOTE_ENV_KEYS,
  ...SCRUBBED_CLAUDE_MODEL_SELECTOR_ENV_KEYS,
  ...SCRUBBED_CLAUDE_SHELL_ENV_KEYS
])

const APPLICATION_MANAGED_CLAUDE_ENV_KEYS = new Set([
  ...APPLICATION_PROVIDED_CLAUDE_ENV_KEYS,
  ...MANAGED_CLAUDE_MODEL_SELECTOR_ENV_KEYS,
  ...SCRUBBED_CLAUDE_ENV_KEYS
])

const BLOCKED_USER_ENV_KEYS = new Set([
  ...APPLICATION_MANAGED_CLAUDE_ENV_KEYS,
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ENABLE_TOOL_SEARCH',
  'CHERRY_STUDIO_BUN_PATH',
  'CHERRY_STUDIO_NODE_PROXY_RULES',
  'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
  BUN_OPTIONS_ENV_KEY,
  'NODE_OPTIONS',
  '__PROTO__',
  'CONSTRUCTOR',
  'PROTOTYPE',
  ...MANAGED_SHELL_ENV_KEYS
])

const removeKeysCaseInsensitively = (env: Record<string, string>, keys: Set<string>): void => {
  for (const key of Object.keys(env)) {
    if (keys.has(key.toUpperCase())) {
      delete env[key]
    }
  }
}

const scrubInheritedClaudeEnvironment = (env: Record<string, string>): void => {
  for (const key of Object.keys(env)) {
    const normalizedKey = key.toUpperCase()
    if (
      SCRUBBED_CLAUDE_ENV_KEYS.has(normalizedKey) ||
      ((APPLICATION_PROVIDED_CLAUDE_ENV_KEYS.has(normalizedKey) ||
        APPLICATION_PROVIDED_CLAUDE_MODEL_SELECTOR_ENV_KEYS.has(normalizedKey)) &&
        key !== normalizedKey)
    ) {
      delete env[key]
    }
  }
}

export function withPreferredWindowsShellEnvironment(
  env: Record<string, string>,
  gitBashPath: string | null,
  windows = isWin
): { env: Record<string, string>; disallowedTools: string[] } {
  const nextEnv = { ...env }

  if (!windows) {
    return { env: nextEnv, disallowedTools: [] }
  }

  removeKeysCaseInsensitively(nextEnv, MANAGED_SHELL_ENV_KEYS)

  if (gitBashPath) {
    nextEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
    return { env: nextEnv, disallowedTools: [] }
  }

  nextEnv.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1'
  nextEnv.POWERSHELL_TELEMETRY_OPTOUT = '1'
  return { env: nextEnv, disallowedTools: ['Bash', 'builtin_Bash'] }
}

export function mergeUserEnvironmentVariables(
  env: Record<string, string>,
  userEnv: unknown,
  windows = isWin
): { env: Record<string, string>; blockedKeys: string[] } {
  const nextEnv = { ...env }
  const blockedKeys: string[] = []

  scrubInheritedClaudeEnvironment(nextEnv)

  if (windows) {
    removeKeysCaseInsensitively(nextEnv, new Set([BUN_OPTIONS_ENV_KEY]))
  } else {
    delete nextEnv[BUN_OPTIONS_ENV_KEY]
  }

  if (userEnv === null || typeof userEnv !== 'object' || Array.isArray(userEnv)) {
    return { env: nextEnv, blockedKeys }
  }

  for (const [key, value] of Object.entries(userEnv)) {
    if (BLOCKED_USER_ENV_KEYS.has(key.toUpperCase())) {
      blockedKeys.push(key)
      continue
    }

    if (typeof value !== 'string') {
      continue
    }

    if (windows) {
      const normalizedKey = key.toUpperCase()
      for (const existingKey of Object.keys(nextEnv)) {
        if (existingKey.toUpperCase() === normalizedKey) {
          delete nextEnv[existingKey]
        }
      }
    }

    nextEnv[key] = value
  }

  return { env: nextEnv, blockedKeys }
}
