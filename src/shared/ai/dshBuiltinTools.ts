export type DshBuiltinToolCategory = 'file' | 'shell' | 'orchestration'

export type DshBuiltinToolDescriptor = {
  /** dsh's runtime-native lowercase tool name == disabledTools write-back id. Never rename these to
   *  another runtime's casing — that would corrupt dsh's tool identity and the approval/policy lookups. */
  name: string
  category: DshBuiltinToolCategory
  /** Catalog default: read-only tools are auto-approved, mutating/side-effecting tools prompt.
   *  The authoritative per-turn gate is the dsh bridge plugin's pre-execute policy. */
  approval: 'auto' | 'prompt'
  /** Path-containment fast-path class ('read' auto-approves in every mode, 'edit' under
   *  acceptEdits). bash carries none: shell stays gated in every non-bypass mode. */
  permissionClass?: 'read' | 'edit'
}

// Single source for the built-ins Cherry's dsh composition mounts (dsh-tool-fs read/read_image/write/edit,
// dsh-tool-bash bash, dsh-tool-todo todo_write), shared by the driver and the edit-dialog catalog.
export const DSH_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'read_image', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'edit', category: 'file', approval: 'prompt', permissionClass: 'edit' },
  { name: 'write', category: 'file', approval: 'prompt', permissionClass: 'edit' },
  { name: 'bash', category: 'shell', approval: 'prompt' },
  // todo_write only appends to the agent's own session log — no filesystem or shell side effects.
  { name: 'todo_write', category: 'orchestration', approval: 'auto' },
  // skill loads Cherry-trusted skill text into context (no fs/shell side effects);
  // read-class + no path arg → the bridge policy auto-allows it in every mode.
  { name: 'skill', category: 'orchestration', approval: 'auto', permissionClass: 'read' },
  // dsh-tool-goal: session-local goal state ops (no fs/shell side effects), todo_write class.
  { name: 'get_goal', category: 'orchestration', approval: 'auto', permissionClass: 'read' },
  { name: 'create_goal', category: 'orchestration', approval: 'auto' },
  { name: 'update_goal', category: 'orchestration', approval: 'auto' }
] as const satisfies readonly DshBuiltinToolDescriptor[]

export const DSH_BUILTIN_TOOL_CATEGORIES = [
  'file',
  'shell',
  'orchestration'
] as const satisfies readonly DshBuiltinToolCategory[]
