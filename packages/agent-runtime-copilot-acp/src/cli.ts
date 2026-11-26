import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const copilotCli = {
  id: 'copilot',
  registryId: 'github-copilot-cli',
  permissionMode: {
    values: { agent: 'default', plan: 'plan', autopilot: 'bypassPermissions' },
    labels: { agent: 'default' },
    allowAll: 'allow_all'
  } satisfies AcpPermissionModes,
  terminalArgs: [],
  name: 'GitHub Copilot',
  protocol: 'acp',
  executable: 'copilot',
  args: ['--acp'],
  helpUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'
} as const
