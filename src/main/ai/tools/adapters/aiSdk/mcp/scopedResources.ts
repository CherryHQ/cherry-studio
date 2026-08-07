/**
 * Reads over the MCP resources reachable in a request scope — the shared core behind
 * `mcp_resource_list` / `mcp_resource_read`.
 *
 * Both entry points take the already-scoped server list (`resolveMcpResourceServers`), so neither
 * this file nor the tools decide which servers a request may touch.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpResourceEntry } from '@shared/ai/builtinTools'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpResource } from '@shared/types/mcp'

const logger = loggerService.withContext('scopedMcpResources')

function toResourceEntry(resource: McpResource): McpResourceEntry {
  return {
    serverName: resource.serverName,
    uri: resource.uri,
    name: resource.name || resource.uri,
    description: resource.description,
    mimeType: resource.mimeType
  }
}

/** Every resource the given servers publish. A server that fails to list is logged and skipped. */
export async function listScopedMcpResources(servers: readonly McpServer[]): Promise<McpResourceEntry[]> {
  const catalog = application.get('McpCatalogService')
  const results = await Promise.allSettled(servers.map((server) => catalog.listResources(server.id)))

  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value.map(toResourceEntry)
    logger.warn('Failed to list resources for an MCP server', {
      serverId: servers[index].id,
      error: result.reason
    })
    return []
  })
}

/**
 * The server publishing `uri`, or `undefined` when no in-scope server claims it.
 *
 * ponytail: first match wins on a uri published by two servers — a per-server argument is the
 * upgrade path if that collision ever shows up in practice. Resources the server never listed
 * (uri templates) resolve only when the scope holds exactly one server.
 */
async function resolveOwningServer(servers: readonly McpServer[], uri: string): Promise<McpServer | undefined> {
  const catalog = application.get('McpCatalogService')
  for (const server of servers) {
    try {
      const resources = await catalog.listResources(server.id)
      if (resources.some((resource) => resource.uri === uri)) return server
    } catch (error) {
      logger.warn('Failed to list resources while resolving a uri', { serverId: server.id, error })
    }
  }
  return servers.length === 1 ? servers[0] : undefined
}

/** Flatten protocol contents the way the model reads them: text verbatim, binary as a placeholder. */
function contentsToText(contents: readonly McpResource[]): string {
  return contents
    .map((content) =>
      content.text !== undefined
        ? content.text
        : `[Binary resource: ${content.mimeType || 'application/octet-stream'}, uri=${content.uri}]`
    )
    .join('\n')
}

export async function readScopedMcpResource(
  servers: readonly McpServer[],
  uri: string
): Promise<{ uri: string; serverName: string; mimeType?: string; text: string } | { error: string }> {
  const server = await resolveOwningServer(servers, uri)
  if (!server) {
    return { error: `No MCP server in this conversation publishes ${uri}. Call mcp_resource_list first.` }
  }

  try {
    const { contents } = await application.get('McpRuntimeService').getResource({ serverId: server.id, uri })
    return {
      uri,
      serverName: server.name,
      mimeType: contents[0]?.mimeType,
      text: contentsToText(contents)
    }
  } catch (error) {
    logger.warn('Failed to read an MCP resource', { serverId: server.id, uri, error })
    return { error: `Failed to read ${uri} from ${server.name}: ${(error as Error).message}` }
  }
}
