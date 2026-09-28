export const ZONEFOUNDRY_SETUP_GUIDE_URL = 'https://zonefoundry.dev/guides/ai-agent-control/'

export const ZONEFOUNDRY_MCP_BASE_URL = 'https://relay.zonefoundry.dev/mcp'
export const ZONEFOUNDRY_MCP_BASE_URL_CN = 'https://relay.zonefoundry.cn/mcp'

export function resolveZoneFoundryMcpBaseUrl(inChina: boolean): string {
  return inChina ? ZONEFOUNDRY_MCP_BASE_URL_CN : ZONEFOUNDRY_MCP_BASE_URL
}
