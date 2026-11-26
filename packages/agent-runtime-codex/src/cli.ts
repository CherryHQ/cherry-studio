import type { CliAuthStatusProbe, PermissionModeCatalog } from '@cherrystudio/agent-runtime/cli'

export const codexCli = {
  id: 'codex',
  cliLogin: [
    {
      id: 'codex-browser',
      args: ['login'],
      nameKey: 'local_agents.auth_codex_browser',
      hintKey: 'local_agents.auth_codex_browser_hint',
      kind: 'browser',
      recommended: true
    },
    {
      id: 'codex-api-key',
      args: ['login', '--with-api-key'],
      nameKey: 'local_agents.auth_codex_api_key',
      hintKey: 'local_agents.auth_codex_api_key_hint',
      kind: 'api-key'
    }
  ],
  authStatus: {
    args: ['login', 'status'],
    includeStderr: true,
    parse(output) {
      if (/^Not logged in$/m.test(output.trim())) return 'signed-out'
      if (/^Logged in using (?:ChatGPT|an API key(?: - .+)?)$/m.test(output.trim())) return 'signed-in'
      return 'unknown'
    }
  } satisfies CliAuthStatusProbe,
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Codex',
  protocol: 'codex',
  executable: 'codex',
  npmPackage: '@openai/codex',
  args: ['app-server'],
  helpUrl: 'https://developers.openai.com/codex/cli',
  modelConfig: { target: 'codex-config', field: 'model', overrides: ['CODEX_HOME'] }
} as const

export const CODEX_PERMISSION_MODES = {
  id: 'codex-mode',
  currentValue: 'workspace',
  application: 'next-turn',
  options: [
    { value: 'readOnly', name: 'Read Only', permissionMode: 'plan' },
    { value: 'workspace', name: 'Workspace', permissionMode: 'acceptEdits' },
    { value: 'fullAccess', name: 'Full Access', permissionMode: 'bypassPermissions' }
  ]
} as const satisfies PermissionModeCatalog

export const CODEX_LOCAL_THOUGHT_LEVEL_ID = 'codex-effort'
export const CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS = [
  { value: 'default', name: 'Default' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'xhigh', name: 'Extra High' }
] as const
