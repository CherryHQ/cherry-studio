export type PiBuiltinToolCategory = 'file' | 'shell' | 'search'

export type PiBuiltinToolDescriptor = {
  /** pi's runtime-native lowercase tool name == disabledTools write-back id. Never rename these to
   *  Claude casing — that would corrupt pi's tool identity and the approval/policy lookups (D8). */
  name: string
  category: PiBuiltinToolCategory
  /** Catalog default: read-only tools are auto-approved, mutating/side-effecting tools prompt.
   *  The authoritative per-turn gate is the pi approval extension. */
  approval: 'auto' | 'prompt'
}

// Single source for pi's 7 built-ins, shared by PiRuntimeDriver/PiRuntimeConnection and the
// edit-dialog catalog so runtime ids and the UI cannot drift.
export const PI_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto' },
  { name: 'grep', category: 'search', approval: 'auto' },
  { name: 'find', category: 'search', approval: 'auto' },
  { name: 'ls', category: 'search', approval: 'auto' },
  { name: 'bash', category: 'shell', approval: 'prompt' },
  { name: 'edit', category: 'file', approval: 'prompt' },
  { name: 'write', category: 'file', approval: 'prompt' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

export const PI_BUILTIN_TOOL_CATEGORIES = [
  'file',
  'shell',
  'search'
] as const satisfies readonly PiBuiltinToolCategory[]
