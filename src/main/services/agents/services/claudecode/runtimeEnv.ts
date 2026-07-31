import { isWin } from '@main/constant'

const MANAGED_SHELL_ENV_KEYS = new Set([
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_USE_POWERSHELL_TOOL',
  'POWERSHELL_TELEMETRY_OPTOUT'
])

const BLOCKED_USER_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CONFIG_DIR',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ENABLE_TOOL_SEARCH',
  'CHERRY_STUDIO_BUN_PATH',
  'CHERRY_STUDIO_NODE_PROXY_RULES',
  'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
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
