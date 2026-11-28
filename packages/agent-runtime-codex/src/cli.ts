import type { CliPreset, PermissionModeCatalog } from '@cherrystudio/agent-runtime/cli'

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
  account: { canReadAccount: true },
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Codex',
  protocol: 'codex',
  subscriptionUsage: true,
  defaultMode: CODEX_PERMISSION_MODES,
  executable: 'codex',
  npmPackage: '@openai/codex',
  args: ['app-server'],
  helpUrl: 'https://developers.openai.com/codex/cli',
  modelConfig: { target: 'codex-config', field: 'model', overrides: ['CODEX_HOME'], nativeSelection: 'agent' }
} as const satisfies CliPreset<'codex', 'codex-config'>
