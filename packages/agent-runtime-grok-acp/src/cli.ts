import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const grokCli = {
  modelConfig: { tool: 'grok-build', target: 'grok-config', overrides: ['GROK_HOME'] },
  id: 'grok-build',
  account: { canReadAccount: true },
  credentialEnvironment: ['XAI_API_KEY', 'GROK_OIDC_ISSUER', 'GROK_OIDC_CLIENT_ID'],
  externalCredentialMethods: ['cached_token', 'grok.com'],
  cliLogin: [
    {
      id: 'grok-browser',
      kind: 'browser',
      nameKey: 'local_agents.sign_in',
      args: ['login', '--oauth'],
      recommended: true
    },
    {
      id: 'grok-device',
      kind: 'browser',
      nameKey: 'local_agents.auth_device_code_label',
      args: ['login', '--device-auth'],
      autoOpenUrl: true
    }
  ],
  name: 'Grok Build',
  protocol: 'acp',
  permissionMode: { bypassArgs: ['agent', '--always-approve', 'stdio'] },
  subscriptionUsage: true,
  executable: 'grok',
  args: ['agent', 'stdio'],
  helpUrl: 'https://docs.x.ai/build/enterprise#authentication'
} as const satisfies AcpCliPreset<'grok-config'>

/** Grok resolves these roles independently of its default model. Preserve user-pinned roles. */
export function setGrokAuxiliaryModels(
  models: Record<string, unknown>,
  selected: string | undefined,
  summary = selected
): void {
  for (const role of ['session_summary', 'prompt_suggestion'] as const) {
    const current = models[role]
    if (current !== undefined && !(typeof current === 'string' && current.startsWith('cherry-'))) continue
    if (selected?.startsWith('cherry-')) models[role] = role === 'session_summary' ? summary : selected
    else delete models[role]
  }
}
