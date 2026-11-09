import {
  Bailian,
  Composio,
  Glama,
  Higress,
  Mcp,
  Mcpso,
  Modelscope,
  Pulse,
  Smithery,
  Zhipu
} from '@cherrystudio/ui/icons/providers'

export const MCP_MARKETS = [
  {
    name: 'MCP World',
    url: 'https://www.mcpworld.com',
    logo: 'https://mcpworld.bdstatic.com/store/v2/865ad5d/mcp-server-store/ec04344/favicon.ico',
    descriptionKey: 'settings.mcp.more.mcpworld'
  },
  {
    name: 'BigModel MCP Market',
    url: 'https://bigmodel.cn/marketplace/index/mcp',
    logo: Zhipu,
    descriptionKey: 'settings.mcp.more.zhipu'
  },
  {
    name: 'modelscope.cn',
    url: 'https://www.modelscope.cn/mcp',
    logo: Modelscope,
    descriptionKey: 'settings.mcp.more.modelscope'
  },
  {
    name: 'mcp.higress.ai',
    url: 'https://mcp.higress.ai/',
    logo: Higress,
    descriptionKey: 'settings.mcp.more.higress'
  },
  {
    name: 'mcp.so',
    url: 'https://mcp.so/',
    logo: Mcpso,
    descriptionKey: 'settings.mcp.more.mcpso'
  },
  {
    name: 'smithery.ai',
    url: 'https://smithery.ai/',
    logo: Smithery,
    descriptionKey: 'settings.mcp.more.smithery'
  },
  {
    name: 'glama.ai',
    url: 'https://glama.ai/mcp/servers',
    logo: Glama,
    descriptionKey: 'settings.mcp.more.glama'
  },
  {
    name: 'pulsemcp.com',
    url: 'https://www.pulsemcp.com',
    logo: Pulse,
    descriptionKey: 'settings.mcp.more.pulsemcp'
  },
  {
    name: 'mcp.composio.dev',
    url: 'https://mcp.composio.dev/',
    logo: Composio,
    descriptionKey: 'settings.mcp.more.composio'
  },
  {
    name: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    logo: Mcp,
    descriptionKey: 'settings.mcp.more.official'
  },
  {
    name: 'Awesome MCP Servers',
    url: 'https://github.com/wong2/awesome-mcp-servers',
    logo: 'https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png',
    descriptionKey: 'settings.mcp.more.awesome'
  }
]

export const MCP_PROVIDER_ENTRIES = [
  { key: 'bailian', nameKey: 'provider.dashscope', logo: Bailian },
  { key: 'modelscope', nameKey: 'ModelScope', logo: Modelscope }
] as const

export function getProviderDisplayName(provider: { nameKey: string }, t: (key: string) => string): string {
  return provider.nameKey.startsWith('provider.') ? t(provider.nameKey) : provider.nameKey
}

export function getMcpProviderLogo(key: string) {
  return MCP_PROVIDER_ENTRIES.find((provider) => provider.key === key)?.logo
}
