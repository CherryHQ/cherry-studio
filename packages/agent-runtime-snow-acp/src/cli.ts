import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const snowCli = {
  modelConfig: { tool: 'snow', target: 'snow-config', overrides: ['SNOW_CONFIG_DIR'] },
  id: 'snow',
  name: 'Snow CLI',
  protocol: 'acp',
  executable: 'snow',
  args: ['--acp'],
  terminalArgs: [],
  npmPackage: 'snow-ai',
  helpUrl: 'https://github.com/MayDay-wpf/snow-cli'
} as const satisfies AcpCliPreset<'snow-config'>
