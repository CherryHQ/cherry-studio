import { application } from '@application'

/**
 * Raw tool names per MCP server id, read from the shared `mcp.tools.<serverId>` cache — the
 * same cache-only facade the runtimes read for denial enforcement
 * (`McpCatalogService.listTools`, which never connects upstream on read). Consumers pass the
 * map into the agent denial-rule migrations (`toolNamesByServerId`), which reverse-map
 * camelized saved fragments onto the raw tool spellings the stable-id and SDK identities keep;
 * a cold cache yields an empty list, and the migration keeps the camelized forms (fail-closed)
 * instead of guessing. The data layer must not import the AI layer, so the cache is read
 * through its declared schema key here; `McpCatalogService` remains the sole write funnel.
 */
export function mountedServerToolNames(mcpIds: readonly string[]): Map<string, readonly string[]> {
  const cache = application.get('CacheService')
  const names = new Map<string, readonly string[]>()
  for (const mcpId of new Set(mcpIds)) {
    const tools = cache.getShared(`mcp.tools.${mcpId}`)
    names.set(
      mcpId,
      (tools ?? []).map((tool) => tool.name)
    )
  }
  return names
}
