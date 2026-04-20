import { toCamelCase } from '@shared/mcp'

export type ToolNameMapping = {
  /** original tool id (serverId__toolName) -> js name */
  toJs: Map<string, string>
  /** js name -> original tool id (serverId__toolName) */
  toOriginal: Map<string, string>
}

export type ToolIdentity = {
  /** original tool id (serverId__toolName) */
  id: string
  /** human-friendly server name (NOT serverId) */
  serverName: string
  /** raw tool name (as reported by the MCP server) */
  toolName: string
}

export function isNamespacedToolId(name: string): boolean {
  return name.includes('__')
}

function capitalizeFirstLetter(str: string): string {
  if (!str) return str
  return str[0].toUpperCase() + str.slice(1)
}

/**
 * Build a readable JS tool name from (serverName, toolName).
 *
 * Examples:
 * - serverName: "GitHub", toolName: "search_repos" -> "githubSearchRepos"
 * - serverName: "@cherry/browser", toolName: "execute" -> "cherryBrowserExecute"
 */
export function buildHubJsToolName(serverName: string | undefined, toolName: string): string {
  const serverPart = serverName ? toCamelCase(serverName) : ''
  const toolPart = toCamelCase(toolName)

  if (!serverPart) {
    return toolPart
  }

  return `${serverPart}${capitalizeFirstLetter(toolPart)}`
}

/**
 * Build a bidirectional tool name mapping.
 *
 * If a collision happens, we deterministically suffix names:
 *   githubSearchRepos, githubSearchRepos_2, githubSearchRepos_3...
 */
export function buildToolNameMapping(tools: ToolIdentity[]): ToolNameMapping {
  // Deterministic: stable order
  const sorted = [...tools].sort((a, b) => a.id.localeCompare(b.id))

  const toJs = new Map<string, string>()
  const toOriginal = new Map<string, string>()

  for (const tool of sorted) {
    const base = buildHubJsToolName(tool.serverName, tool.toolName)
    let jsName = base
    let i = 2
    while (toOriginal.has(jsName)) {
      jsName = `${base}_${i}`
      i += 1
    }

    toJs.set(tool.id, jsName)
    toOriginal.set(jsName, tool.id)
  }

  return { toJs, toOriginal }
}

export function resolveToolId(mapping: ToolNameMapping, nameOrId: string): string | undefined {
  if (!nameOrId) return undefined

  if (isNamespacedToolId(nameOrId)) {
    return nameOrId
  }

  return mapping.toOriginal.get(nameOrId)
}
