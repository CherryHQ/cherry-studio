/**
 * MCP Settings 页面导航工具函数
 */

export const MCPRoutes = {
  // 管理类页面
  servers: '/settings/mcp/servers',
  npxSearch: '/settings/mcp/npx-search',
  mcpInstall: '/settings/mcp/mcp-install',

  // 发现类页面
  builtin: '/settings/mcp/builtin',
  marketplaces: '/settings/mcp/marketplaces',

  // 服务商页面
  modelscope: '/settings/mcp/modelscope',
  tokenflux: '/settings/mcp/tokenflux',
  lanyun: '/settings/mcp/lanyun',
  '302ai': '/settings/mcp/302ai',
  bailian: '/settings/mcp/bailian'
} as const

/**
 * 导航到 MCP 设置页面的指定部分
 * @param page 页面标识
 * @returns 路由路径
 */
export function getMCPRoute(page: keyof typeof MCPRoutes): string {
  return MCPRoutes[page]
}

/**
 * 生成 MCP 服务商页面路由
 * @param providerKey 服务商标识
 * @returns 路由路径
 */
export function getMCPProviderRoute(providerKey: string): string {
  return `/settings/mcp/${providerKey}`
}

/**
 * 生成 MCP 服务器设置页面路由
 * @param serverId 服务器ID
 * @returns 路由路径
 */
export function getMCPServerSettingsRoute(serverId: string): string {
  return `/settings/mcp/settings/${serverId}`
}

// 类型定义
export type MCPPage = keyof typeof MCPRoutes
