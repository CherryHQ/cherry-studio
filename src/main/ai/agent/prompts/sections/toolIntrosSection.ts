import { getDeferredToolsSystemPrompt } from '../../../prompts/deferredTools'
import { TOOL_SEARCH_TOOL_NAME } from '../../../tools/meta/toolSearch'
import type { SectionContributor } from './types'

/**
 * Generic tool-use guidance. Currently only emits the
 * deferred-tools / `tool_search` inventory when `tool_search` is in
 * the active tool set. Cacheable — the toolset only changes when the
 * user installs / removes an MCP server or toggles a built-in tool,
 * neither of which happens per-call.
 */
export const toolIntrosSection: SectionContributor = (ctx) => {
  if (!ctx.tools || !(TOOL_SEARCH_TOOL_NAME in ctx.tools)) return undefined

  return {
    id: 'tool_intros',
    text: getDeferredToolsSystemPrompt(ctx.deferredEntries),
    cacheable: true
  }
}
