export const hermesCli = {
  modelConfig: { target: 'hermes-config', overrides: ['HERMES_HOME'] },
  id: 'hermes',
  terminalArgs: [],
  permissionMode: { values: { session: { canonicalMode: 'auto', priority: 0 } } },
  name: 'Hermes',
  protocol: 'acp',
  executable: 'hermes',
  args: ['acp'],
  helpUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/'
} as const
