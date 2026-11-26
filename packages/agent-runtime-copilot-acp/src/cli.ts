export const copilotCli = {
  id: 'copilot',
  registryId: 'github-copilot-cli',
  permissionMode: { labels: { agent: { canonicalMode: 'default', priority: 1 } } },
  terminalArgs: [],
  name: 'GitHub Copilot',
  protocol: 'acp',
  executable: 'copilot',
  args: ['--acp'],
  helpUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server'
} as const
