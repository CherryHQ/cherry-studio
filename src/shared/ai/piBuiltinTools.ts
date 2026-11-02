import { CLAUDE_TOOL_DEFS } from './claudecode/toolRegistry'

export type PiBuiltinToolCategory = 'file' | 'shell' | 'search'
export type PiToolPermissionClass = 'read' | 'edit' | 'shell' | 'meta'

export type PiBuiltinToolDescriptor = {
  /** pi's runtime-native lowercase tool name == disabledTools write-back id. Never rename these to
   *  Claude casing — that would corrupt pi's tool identity and the approval/policy lookups (D8). */
  name: string
  category: PiBuiltinToolCategory
  /** Catalog default: read-only tools are auto-approved, mutating/side-effecting tools prompt.
   *  The authoritative per-turn gate is the pi approval extension. */
  approval: 'auto' | 'prompt'
  permissionClass: PiToolPermissionClass
}

export const PI_TOOL_SEARCH_TOOL_NAME = 'tool_search'
export const PI_TOOL_CALL_TOOL_NAME = 'tool_call'
export const PI_TOOL_EXEC_TOOL_NAME = 'codemode'
export const PI_TOOL_RECALL_TOOL_NAME = 'vcc_recall'

export const PI_NATIVE_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'bash', category: 'shell', approval: 'prompt', permissionClass: 'shell' },
  { name: 'edit', category: 'file', approval: 'prompt', permissionClass: 'edit' },
  { name: 'write', category: 'file', approval: 'prompt', permissionClass: 'edit' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

// Single catalog shared by runtime policy and the edit dialog for Pi native tools.
export const PI_BUILTIN_TOOLS = [
  ...PI_NATIVE_BUILTIN_TOOLS,
  { name: PI_TOOL_RECALL_TOOL_NAME, category: 'search', approval: 'auto', permissionClass: 'meta' },
  { name: PI_TOOL_SEARCH_TOOL_NAME, category: 'search', approval: 'auto', permissionClass: 'meta' },
  { name: PI_TOOL_EXEC_TOOL_NAME, category: 'shell', approval: 'auto', permissionClass: 'meta' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

/** Keep runtime policy and the edit form aligned with previously stored tool names. */
export function normalizePiDisabledToolId(name: string): string {
  if (name === 'tool_exec') return PI_TOOL_EXEC_TOOL_NAME
  return PI_NATIVE_BUILTIN_TOOLS.find((tool) => tool.name === name.toLowerCase())?.name ?? name
}

type PiDependencyToolRef = { name: string; serverName: string; serverId: string }

const TOOL_DEFS_BY_LOWER_NAME = new Map(CLAUDE_TOOL_DEFS.map((def) => [def.name.toLowerCase(), def]))

/**
 * Pi's policy layer only resolves direct identifiers and aliases, so a tool that declares a
 * static dependency (a second shell door) would survive disabling that dependency. Walk the
 * registry's `dependsOn` graph with the same case-insensitive builtin matching Pi applies.
 */
export function isPiToolDisabledByDependency(
  runtimeName: string,
  disabled: ReadonlySet<string>,
  resolveMcpTool?: (name: string) => PiDependencyToolRef | undefined,
  seen: ReadonlySet<string> = new Set()
): boolean {
  const key = runtimeName.toLowerCase()
  if (seen.has(key)) return false
  const tool = resolveMcpTool?.(runtimeName)
  const def =
    TOOL_DEFS_BY_LOWER_NAME.get(key) ??
    (tool
      ? (TOOL_DEFS_BY_LOWER_NAME.get(`mcp__${tool.serverName}__${tool.name}`.toLowerCase()) ??
        TOOL_DEFS_BY_LOWER_NAME.get(`mcp__${tool.serverId}__${tool.name}`.toLowerCase()))
      : undefined)
  if (!def?.dependsOn?.length) return false
  const nextSeen = new Set(seen).add(key)
  return def.dependsOn.some(
    (dependency) =>
      disabled.has(dependency) ||
      disabled.has(dependency.toLowerCase()) ||
      isPiToolDisabledByDependency(dependency, disabled, resolveMcpTool, nextSeen)
  )
}

export const PI_BUILTIN_TOOL_CATEGORIES = [
  'file',
  'shell',
  'search'
] as const satisfies readonly PiBuiltinToolCategory[]
