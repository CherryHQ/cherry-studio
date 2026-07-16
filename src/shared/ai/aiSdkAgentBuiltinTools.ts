export type AiSdkAgentBuiltinToolCategory = 'file' | 'shell' | 'search' | 'skill'

export type AiSdkAgentBuiltinToolDescriptor = {
  /** Runtime-native lowercase tool name == disabledTools write-back id. The AI SDK agent
   *  runtime owns this vocabulary — never rename to another runtime's casing (policy lookups
   *  and the edit-dialog catalog both key on it). */
  name: string
  category: AiSdkAgentBuiltinToolCategory
  /** Catalog default, fail-closed: read-only tools are auto-approved, mutating/side-effecting
   *  tools prompt. The authoritative per-call gate is the runtime's execution-time policy. */
  approval: 'auto' | 'prompt'
}

// Single source for the AI SDK agent runtime's built-ins, shared by the driver/connection
// (tool registration + policy), the capability descriptor, and the edit-dialog catalog so
// runtime ids and the UI cannot drift. The tools themselves ship with the runtime's tool
// phase; the id set is fixed here so policy written against it stays stable.
export const AI_SDK_AGENT_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto' },
  { name: 'ls', category: 'search', approval: 'auto' },
  { name: 'glob', category: 'search', approval: 'auto' },
  { name: 'grep', category: 'search', approval: 'auto' },
  { name: 'write', category: 'file', approval: 'prompt' },
  { name: 'edit', category: 'file', approval: 'prompt' },
  { name: 'bash', category: 'shell', approval: 'prompt' },
  { name: 'skill', category: 'skill', approval: 'auto' }
] as const satisfies readonly AiSdkAgentBuiltinToolDescriptor[]
