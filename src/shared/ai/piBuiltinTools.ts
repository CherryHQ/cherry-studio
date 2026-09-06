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
export const PI_TOOL_DESCRIBE_TOOL_NAME = 'tool_describe'
export const PI_TOOL_CALL_TOOL_NAME = 'tool_call'
export const PI_TOOL_EXEC_TOOL_NAME = 'tool_exec'

export const PI_NATIVE_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'bash', category: 'shell', approval: 'prompt', permissionClass: 'shell' },
  { name: 'edit', category: 'file', approval: 'prompt', permissionClass: 'edit' },
  { name: 'write', category: 'file', approval: 'prompt', permissionClass: 'edit' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

// Single catalog shared by runtime policy and the edit dialog; code mode is implemented as Pi
// custom tools but is user-facing and configurable alongside Pi's native built-ins.
export const PI_BUILTIN_TOOLS = [
  ...PI_NATIVE_BUILTIN_TOOLS,
  { name: PI_TOOL_SEARCH_TOOL_NAME, category: 'search', approval: 'auto', permissionClass: 'meta' },
  { name: PI_TOOL_DESCRIBE_TOOL_NAME, category: 'search', approval: 'auto', permissionClass: 'meta' },
  { name: PI_TOOL_CALL_TOOL_NAME, category: 'search', approval: 'auto', permissionClass: 'meta' },
  { name: PI_TOOL_EXEC_TOOL_NAME, category: 'shell', approval: 'prompt', permissionClass: 'shell' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

export const PI_BUILTIN_TOOL_CATEGORIES = [
  'file',
  'shell',
  'search'
] as const satisfies readonly PiBuiltinToolCategory[]
