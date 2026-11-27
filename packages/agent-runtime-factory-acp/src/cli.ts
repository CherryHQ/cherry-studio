import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const factoryCli = {
  id: 'factory-droid',
  account: { canReadAccount: true },
  accountArgs: ['exec', '--output-format', 'acp'],
  loginArgs: [],
  externalCredentialMethods: ['device-pairing', 'factory-api-key'],
  credentialEnvironment: ['FACTORY_API_KEY'],
  terminalArgs: [],
  name: 'Factory Droid',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'droid',
  args: ['exec', '--output-format', 'acp-daemon'],
  env: {
    DROID_DISABLE_AUTO_UPDATE: 'true',
    FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false'
  },
  helpUrl: 'https://factory.ai/product/cli'
} as const satisfies AcpCliPreset
