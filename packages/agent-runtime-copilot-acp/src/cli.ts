import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const copilotCli = {
  id: 'copilot',
  account: { canReadAccount: true, methods: [] },
  loginArgs: ['login'],
  registryId: 'github-copilot-cli',
  minimumAcpVersion: '0.0.401',
  permissionMode: {
    values: {
      agent: 'default',
      plan: 'plan',
      autopilot: 'bypassPermissions',
      'https://agentclientprotocol.com/protocol/session-modes#agent': 'default',
      'https://agentclientprotocol.com/protocol/session-modes#plan': 'plan',
      'https://agentclientprotocol.com/protocol/session-modes#autopilot': 'bypassPermissions',
      off: 'default',
      auto: 'auto',
      on: 'bypassPermissions'
    },
    labels: { agent: 'default' },
    approvalConfigId: 'allow_all',
    allowAll: 'allow_all'
  },
  terminalArgs: [],
  name: 'GitHub Copilot',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'copilot',
  args: ['--acp'],
  helpUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'
} as const satisfies AcpCliPreset
