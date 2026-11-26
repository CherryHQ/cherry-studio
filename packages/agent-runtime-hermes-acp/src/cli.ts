import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const hermesCli = {
  modelConfig: { target: 'hermes-config', overrides: ['HERMES_HOME'] },
  id: 'hermes',
  terminalArgs: [],
  permissionMode: {
    values: { ask: 'default', workspace_session: 'acceptEdits', session: 'auto' },
    configIds: ['edit_approval_policy']
  } satisfies AcpPermissionModes,
  name: 'Hermes',
  protocol: 'acp',
  executable: 'hermes',
  args: ['acp'],
  helpUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/'
} as const
