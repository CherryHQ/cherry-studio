/**
 * Meta-tool names (the deferred-tool dispatch tools). Kept in a standalone,
 * React-free module so low-level utilities (e.g. `toolResponse`) can recognise
 * them without importing the renderer component that displays them.
 */
import { CHERRY_CLIENT_TOOL_PREFIX, CHERRY_META_TOOL_NAMES } from '@shared/ai/tools/cherryClientToolName'

export const LEGACY_META_TOOL_NAMES = ['tool_search', 'tool_inspect', 'tool_invoke', 'tool_exec'] as const
export const META_TOOL_NAMES = [...CHERRY_META_TOOL_NAMES, ...LEGACY_META_TOOL_NAMES] as const
export type MetaToolName = (typeof META_TOOL_NAMES)[number]
export type MetaToolKind = (typeof LEGACY_META_TOOL_NAMES)[number]

export function isMetaToolName(name: string): name is MetaToolName {
  return (META_TOOL_NAMES as readonly string[]).includes(name)
}

export function getMetaToolKind(name: MetaToolName): MetaToolKind {
  return (
    name.startsWith(CHERRY_CLIENT_TOOL_PREFIX) ? name.slice(CHERRY_CLIENT_TOOL_PREFIX.length) : name
  ) as MetaToolKind
}
