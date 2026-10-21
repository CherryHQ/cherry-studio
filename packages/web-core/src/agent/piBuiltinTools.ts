// Web `piBuiltinTools.ts`: the Pi tools `fileTools.ts` implements. `ls`, `find` and `grep` are read-class,
// so the desktop approval rules run them without asking inside the workspace, as they do `read`.
import type { PiBuiltinToolDescriptor } from '@shared/ai/piBuiltinTools'

export {
  normalizePiDisabledToolId,
  PI_BUILTIN_TOOL_CATEGORIES,
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_RECALL_TOOL_NAME,
  PI_TOOL_SEARCH_TOOL_NAME,
  type PiBuiltinToolCategory,
  type PiBuiltinToolDescriptor,
  type PiToolPermissionClass
} from '@shared/ai/piBuiltinTools'

export const PI_NATIVE_BUILTIN_TOOLS = [
  { name: 'read', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'ls', category: 'file', approval: 'auto', permissionClass: 'read' },
  { name: 'find', category: 'search', approval: 'auto', permissionClass: 'read' },
  { name: 'grep', category: 'search', approval: 'auto', permissionClass: 'read' },
  { name: 'edit', category: 'file', approval: 'prompt', permissionClass: 'edit' },
  { name: 'write', category: 'file', approval: 'prompt', permissionClass: 'edit' }
] as const satisfies readonly PiBuiltinToolDescriptor[]

export const PI_BUILTIN_TOOLS = PI_NATIVE_BUILTIN_TOOLS
