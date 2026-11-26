import {
  parseBooleanLoginStatus,
  type CliAuthStatusProbe,
  type PermissionModeCatalog
} from '@cherrystudio/agent-runtime/cli'

export const CLAUDE_PERMISSION_MODES = {
  id: 'claude-mode',
  currentValue: 'default',
  application: 'session',
  options: [
    { value: 'default', name: 'Default', permissionMode: 'default' },
    { value: 'acceptEdits', name: 'Accept Edits', permissionMode: 'acceptEdits' },
    { value: 'plan', name: 'Plan', permissionMode: 'plan' },
    { value: 'auto', name: 'Auto', permissionMode: 'auto' },
    { value: 'bypassPermissions', name: 'Bypass Permissions', permissionMode: 'bypassPermissions' }
  ]
} as const satisfies PermissionModeCatalog

export const claudeCli = {
  modelConfig: { target: 'claude-settings', overrides: ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_MODEL'] },
  id: 'claude',
  windowsShell: { variable: 'CLAUDE_CODE_GIT_BASH_PATH', allowSh: false },
  cliLogin: [
    {
      id: 'claude-subscription',
      args: ['auth', 'login', '--claudeai'],
      nameKey: 'local_agents.auth_claude_subscription',
      hintKey: 'local_agents.auth_claude_subscription_hint',
      kind: 'browser',
      recommended: true
    },
    {
      id: 'claude-console',
      args: ['auth', 'login', '--console'],
      nameKey: 'local_agents.auth_claude_console',
      hintKey: 'local_agents.auth_claude_console_hint',
      kind: 'browser'
    }
  ],
  authStatus: {
    args: ['auth', 'status', '--json'],
    parse: (output) => parseBooleanLoginStatus(output, 'loggedIn')
  } satisfies CliAuthStatusProbe,
  loginArgs: ['auth', 'login'],
  terminalArgs: [],
  name: 'Claude Code',
  protocol: 'claude',
  defaultMode: CLAUDE_PERMISSION_MODES,
  executable: 'claude',
  npmPackage: '@anthropic-ai/claude-code',
  args: [],
  helpUrl: 'https://code.claude.com/docs/en/setup'
} as const

export const claudeModelProfile = {
  format: 'json' as const,
  target: 'claude-settings' as const,
  readModel(doc: Record<string, unknown>) {
    const env = doc.env
    const override = env && typeof env === 'object' && 'ANTHROPIC_MODEL' in env && env.ANTHROPIC_MODEL
    const model = override || doc.model
    return typeof model === 'string' && model ? model : undefined
  },
  writeModel(_doc: Record<string, unknown>, model: string | undefined): [string[], string | undefined][] {
    return [
      [['model'], model],
      [['env', 'ANTHROPIC_MODEL'], model]
    ]
  }
}

const CLAUDE_CREDENTIAL_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS'] as const
const CLAUDE_PROVIDER_ENV_KEYS = ['ANTHROPIC_BASE_URL', ...CLAUDE_CREDENTIAL_ENV_KEYS, 'ANTHROPIC_MODEL'] as const

export function scheduledClaudeEnvironment(
  base: Record<string, string>,
  settings: Record<string, unknown> | undefined,
  overrides: Record<string, string>,
  merge: (...sources: Record<string, string>[]) => Record<string, string>
) {
  function mergeProvider(base: Record<string, string>, overlay: Record<string, string>) {
    const env = { ...base }
    if (
      (overlay.ANTHROPIC_BASE_URL !== undefined && overlay.ANTHROPIC_BASE_URL !== base.ANTHROPIC_BASE_URL) ||
      CLAUDE_CREDENTIAL_ENV_KEYS.some((key) => overlay[key] !== undefined)
    ) {
      for (const key of CLAUDE_CREDENTIAL_ENV_KEYS) delete env[key]
    }
    return merge(env, overlay)
  }
  const saved = settings?.env
  const provider =
    saved && typeof saved === 'object'
      ? Object.fromEntries(
          CLAUDE_PROVIDER_ENV_KEYS.flatMap((key) => {
            const value = Reflect.get(saved, key)
            return typeof value === 'string' ? [[key, value]] : []
          })
        )
      : {}
  return mergeProvider(mergeProvider(base, provider), merge(overrides))
}
