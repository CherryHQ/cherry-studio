import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const museCodeCli = {
  id: 'muse-code',
  name: 'Muse Code',
  protocol: 'acp',
  subscriptionUsage: true,
  permissionMode: {
    values: {
      allowall: 'bypassPermissions',
      promptunmatched: 'default',
      onrequest: 'default',
      denyunmatched: 'default'
    },
    labels: {
      'allow all': 'bypassPermissions',
      'ask before unmatched actions': 'default',
      'ask on request': 'default',
      'deny unmatched actions': 'default'
    },
    nativePermissionNames: true
  },
  executable: 'muse',
  args: ['acp'],
  env: { MUSE_EXPERIMENTAL_ACP: 'on' },
  terminalArgs: [],
  loginArgs: ['login'],
  credentialEnvironment: ['META_API_KEY'],
  helpUrl: 'https://dev.meta.ai/docs/muse-code'
} as const satisfies AcpCliPreset
