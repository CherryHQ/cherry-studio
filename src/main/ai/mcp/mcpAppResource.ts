import { isIP } from 'node:net'

import { McpUiResourceMetaSchema, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/app-bridge'

import type { McpResource } from '@shared/types/mcp'

export const MCP_APP_SCHEME = 'cherry-mcp-app'
export const MCP_APP_PARTITION_PREFIX = 'mcp-app:'
export const MCP_APP_SHELL_URL = `${MCP_APP_SCHEME}://view/shell`
export const MCP_APP_VIEW_URL = `${MCP_APP_SCHEME}://view/content`

export const MCP_APP_SCHEME_DECLARATION = {
  scheme: MCP_APP_SCHEME,
  privileges: { standard: true, secure: true }
}

function exactHttpsOrigins(domains: string[] = []): string[] {
  return domains.map((domain) => {
    const url = new URL(domain)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname.includes('.') ||
      url.hostname.endsWith('.') ||
      url.hostname.includes('*') ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local') ||
      isIP(url.hostname.replace(/^\[|\]$/g, ''))
    ) {
      throw new Error('Invalid MCP App origin')
    }
    return url.origin
  })
}

export function prepareMcpAppResource(contents: McpResource[], uri: string) {
  const matching = contents.filter((item) => item.uri === uri)
  const item = matching[0]
  if (
    matching.length !== 1 ||
    item.mimeType !== RESOURCE_MIME_TYPE ||
    typeof item.text !== 'string' ||
    Buffer.byteLength(item.text, 'utf8') > 2 * 1024 * 1024
  ) {
    throw new Error('Invalid MCP App resource')
  }

  const meta = McpUiResourceMetaSchema.parse(item._meta?.ui ?? {})
  const assets = exactHttpsOrigins(meta.csp?.resourceDomains)
  const connect = exactHttpsOrigins(meta.csp?.connectDomains)
  const assetSources = assets.join(' ')
  return {
    html: item.text,
    origins: [...new Set([...assets, ...connect])],
    csp: [
      "default-src 'none'",
      `script-src 'unsafe-inline' ${assetSources}`.trim(),
      `style-src 'unsafe-inline' ${assetSources}`.trim(),
      `img-src data: ${assetSources}`.trim(),
      `font-src ${assetSources || "'none'"}`,
      `media-src ${assetSources || "'none'"}`,
      `connect-src ${connect.join(' ') || "'none'"}`,
      "form-action 'none'",
      "base-uri 'none'",
      "frame-src 'none'",
      "object-src 'none'"
    ].join('; ')
  }
}
