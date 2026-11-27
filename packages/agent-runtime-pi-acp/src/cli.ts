import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const piCli = {
  modelConfig: { target: 'pi-settings', overrides: ['PI_CODING_AGENT_DIR'] },
  id: 'pi-acp',
  credentialScope: 'provider',
  loginArgs: ['auth', 'login'],
  providerLogin: {
    id: 'pi-browser',
    args: ['auth', 'login'],
    suggestions: ['openai-codex', 'github-copilot', 'anthropic', 'openai']
  },
  terminalArgs: [],
  terminalUsesInstalledCli: true,
  name: 'Pi',
  protocol: 'acp',
  legacyModes: 'effort',
  executable: 'pi',
  npmPackage: '@earendil-works/pi-coding-agent',
  args: [],
  helpUrl: 'https://github.com/svkozak/pi-acp'
} as const satisfies AcpCliPreset<'pi-settings'>
