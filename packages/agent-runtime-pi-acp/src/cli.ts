export const piCli = {
  modelConfig: { target: 'pi-settings', overrides: ['PI_CODING_AGENT_DIR'] },
  id: 'pi-acp',
  loginArgs: ['auth', 'login'],
  providerLogin: {
    id: 'pi-browser',
    args: ['auth', 'login'],
    suggestions: ['openai-codex', 'github-copilot', 'anthropic', 'openai']
  },
  terminalArgs: [],
  name: 'Pi',
  protocol: 'acp',
  legacyModes: 'effort',
  executable: 'pi',
  npmPackage: '@earendil-works/pi-coding-agent',
  args: [],
  helpUrl: 'https://github.com/svkozak/pi-acp'
} as const
