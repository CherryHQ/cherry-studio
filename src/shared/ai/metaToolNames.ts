/**
 * Meta-tool names (the deferred-tool dispatch tools). Kept in a standalone,
 * React-free module so low-level utilities (e.g. `toolResponse`) can recognise
 * them without importing the renderer component that displays them.
 */
export const META_TOOL_NAMES = ['tool_search', 'tool_inspect', 'tool_invoke', 'tool_exec'] as const
export type MetaToolName = (typeof META_TOOL_NAMES)[number]

export function isMetaToolName(name: string): name is MetaToolName {
  return (META_TOOL_NAMES as readonly string[]).includes(name)
}
