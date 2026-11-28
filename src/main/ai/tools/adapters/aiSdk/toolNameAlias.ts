import type { Tool } from 'ai'

/**
 * Alias resolution for MCP protocol names.
 *
 * The model sometimes calls a tool by the human-readable protocol name it saw
 * in the conversation ('nmap_scan') instead of the wire id the ToolSet is keyed
 * by ('mcp__{serverSlug}__{toolSlug}_{identityDigest}'). Without a rescue, that
 * call dies as NoSuchToolError ("tool is not available") even though the tool
 * is connected, discovered, and enabled for the request (#24583).
 *
 * MCP entries carry the original protocol name in `metadata.cherry.tool.name`
 * (see `mcp/mcpTools.ts`), so an alias can be mapped back to its wire id. A
 * match is used only when it is unique: two servers can expose the same
 * protocol name, and guessing between them would call the wrong server.
 */
type CherryToolMetadata = { cherry?: { tool?: { type?: string; name?: string } } }

export function mcpProtocolName(tool: Tool | undefined): string | undefined {
  const metadata = tool?.metadata as CherryToolMetadata | undefined
  const toolMeta = metadata?.cherry?.tool
  return toolMeta?.type === 'mcp' ? toolMeta?.name : undefined
}

export type ToolNameAliasResolution = { resolved: string } | { ambiguous: string[] } | undefined

/**
 * Map an alias to the unique candidate whose MCP protocol name equals it.
 * Returns undefined when nothing matches; `{ ambiguous }` when several do.
 */
export function resolveToolNameAlias(
  alias: string,
  candidates: Iterable<string>,
  getTool: (name: string) => Tool | undefined
): ToolNameAliasResolution {
  const matches: string[] = []
  for (const name of candidates) {
    if (name === alias) continue // exact names never need an alias
    if (mcpProtocolName(getTool(name)) === alias) matches.push(name)
  }
  if (matches.length === 1) return { resolved: matches[0] }
  if (matches.length > 1) return { ambiguous: matches }
  return undefined
}

/**
 * Resolve a model-supplied tool name against a request's allowed set, bridging
 * MCP protocol-name aliases. Throws a reasoned error when the name stays
 * unresolved, so the model can tell "no such tool here" from a transient
 * failure and can self-correct via tool_search (#24583 acceptance criterion:
 * the error must say why a discovered tool cannot be called).
 */
export function resolveRequestToolName(
  requestedName: string,
  allowedNames: ReadonlySet<string>,
  getTool: (name: string) => Tool | undefined
): string {
  if (allowedNames.has(requestedName)) return requestedName
  const alias = resolveToolNameAlias(requestedName, allowedNames, getTool)
  if (alias && 'resolved' in alias) return alias.resolved
  if (alias && 'ambiguous' in alias) {
    throw new Error(
      `Tool not available in this request: ${requestedName} (the name matches ${alias.ambiguous.join(' and ')}; retry with the exact name)`
    )
  }
  throw new Error(
    `Tool not available in this request: ${requestedName} (no enabled tool exposes this name; run tool_search to list what this request can call)`
  )
}
