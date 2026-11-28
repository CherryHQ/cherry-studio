import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const ompCli = {
  modelConfig: {
    tool: 'omp',
    target: 'omp-settings',
    overrides: ['OMP_PROFILE', 'PI_PROFILE', 'PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR']
  },
  id: 'omp',
  permissionMode: {
    bypassArgs: ['acp', '--yolo'],
    values: { default: 'default', plan: 'plan' }
  },
  credentialScope: 'provider',
  name: 'Oh My Pi',
  protocol: 'acp',
  executable: 'omp',
  args: ['acp'],
  terminalArgs: [],
  npmPackage: '@oh-my-pi/pi-coding-agent',
  requiredRuntime: { executable: 'bun', minimumVersion: '1.4.4' },
  helpUrl: 'https://github.com/can1357/oh-my-pi'
} as const satisfies AcpCliPreset<'omp-settings'>
