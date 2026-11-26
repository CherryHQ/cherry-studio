import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const copilotCli = {
  id: 'copilot',
  account: { canReadAccount: true, methods: [] },
  loginArgs: ['login'],
  registryId: 'github-copilot-cli',
  minimumAcpVersion: '0.0.401',
  permissionMode: {
    values: { agent: 'default', plan: 'plan', autopilot: 'bypassPermissions' },
    labels: { agent: 'default' },
    allowAll: 'allow_all'
  } satisfies AcpPermissionModes,
  terminalArgs: [],
  name: 'GitHub Copilot',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'copilot',
  args: ['--acp'],
  helpUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'
} as const
