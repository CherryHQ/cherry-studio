/**
 * Reads over the MCP resources reachable in a request scope — the shared core behind
 * `mcp_resource_list` / `mcp_resource_read`.
 *
 * Both entry points take the already-scoped server list (`resolveMcpResourceServers` intersected
 * with the request's frozen server ids), so neither this file nor the tools decide which servers a
 * request may touch.
 *
 * A resource is addressed by `(serverName, uri)` and must appear in that server's published list:
 * a uri alone is ambiguous across servers, and a uri the server never published is not something
 * the model may ask for (uri templates are not supported — they would need `resources/templates/list`
 * and an explicit match rule).
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpResourceEntry, McpResourceReadResult } from '@shared/ai/builtinTools'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpResource } from '@shared/types/mcp'

const logger = loggerService.withContext('scopedMcpResources')

export interface ReadScopedMcpResourceOptions {
  serverName: string
  uri: string
  offset?: number
  /** Max characters this page may return; the caller passes the request's tool-output cap. */
  charCap: number
  signal?: AbortSignal
}

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
  { serverName, uri, offset = 0, charCap, signal }: ReadScopedMcpResourceOptions
): Promise<McpResourceReadResult> {
  const server = servers.find((candidate) => candidate.name === serverName)
  if (!server) {
    return { error: `No MCP server named "${serverName}" is available in this conversation.` }
  }

  // The server's own published list is the allow-list: it is what `mcp_resource_list` showed, so
  // anything outside it is a uri the model constructed rather than one the user made reachable.
  let published: readonly McpResource[]
  try {
    published = await application.get('McpCatalogService').listResources(server.id)
  } catch (error) {
    logger.warn('Failed to list resources while validating a read', { serverId: server.id, error })
    return { error: `Could not reach ${server.name} to verify ${uri}.` }
  }
  if (!published.some((resource) => resource.uri === uri)) {
    return { error: `${server.name} does not publish ${uri}. Call mcp_resource_list first.` }
  }

  try {
    const { contents } = await application.get('McpRuntimeService').getResource({ serverId: server.id, uri, signal })
    const full = contentsToText(contents)
    const start = Math.min(offset, full.length)
    const text = full.slice(start, start + charCap)
    const end = start + text.length
    return {
      uri,
      serverName: server.name,
      mimeType: contents[0]?.mimeType,
      text,
      totalChars: full.length,
      ...(end < full.length && { nextOffset: end })
    }
  } catch (error) {
    logger.warn('Failed to read an MCP resource', { serverId: server.id, uri, error })
    return { error: `Failed to read ${uri} from ${server.name}: ${(error as Error).message}` }
  }
}
