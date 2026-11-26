import type { CliAuthStatusProbe } from '@cherrystudio/agent-runtime/cli'

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

export const codexGateway = {
  format: 'toml',
  related: { format: 'json', target: 'codex-auth' },
  read(doc: Record<string, unknown>, _model: string, _env: unknown, auth: Record<string, unknown> | undefined) {
    const providers = doc.model_providers
    const provider: unknown =
      providers && typeof providers === 'object' && typeof doc.model_provider === 'string'
        ? Reflect.get(providers, doc.model_provider)
        : undefined
    return {
      baseUrl: provider && typeof provider === 'object' && 'base_url' in provider ? provider.base_url : undefined,
      apiKey: auth?.OPENAI_API_KEY,
      model: doc.model,
      path:
        provider && typeof provider === 'object' && 'wire_api' in provider && provider.wire_api === 'chat'
          ? '/v1/chat/completions'
          : '/v1/responses'
    }
  }
} as const

export const CODEX_LOCAL_MODE_ID = 'codex-mode'
export const CODEX_LOCAL_MODE_OPTIONS = [
  { value: 'readOnly', name: 'Read Only' },
  { value: 'workspace', name: 'Workspace' },
  { value: 'fullAccess', name: 'Full Access' }
] as const

export const CODEX_LOCAL_THOUGHT_LEVEL_ID = 'codex-effort'
export const CODEX_LOCAL_THOUGHT_LEVEL_OPTIONS = [
  { value: 'default', name: 'Default' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'xhigh', name: 'Extra High' }
] as const
