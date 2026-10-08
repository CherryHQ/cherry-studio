import type { ToolSet } from 'ai'

import { createToolSearchTool, TOOL_SEARCH_TOOL_NAME } from '../meta/toolSearch'
import type { ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { shouldDefer } from './shouldDefer'

export interface ApplyDeferExpositionResult {
  tools: ToolSet | undefined
  deferredEntries: ToolEntry[]
}

export async function applyDeferExposition(
  tools: ToolSet | undefined,
  registry: ToolRegistry,
  contextWindow: number | undefined
): Promise<ApplyDeferExpositionResult> {
  // Caller-provided tools retain their names and dispatch, including a custom search tool.
  if (!tools || Object.hasOwn(tools, TOOL_SEARCH_TOOL_NAME)) return { tools, deferredEntries: [] }

  const candidateEntries = Object.entries(tools)
    .map(([name, tool]) => {
      const entry = registry.getByName(name)
      return entry?.tool === tool && tool.type !== 'provider' ? entry : undefined
    })
    .filter((entry): entry is ToolEntry => entry !== undefined)

  const { deferredNames } = await shouldDefer(candidateEntries, contextWindow)
  if (deferredNames.size === 0) return { tools, deferredEntries: [] }

  const deferredEntries = candidateEntries.filter((entry) => deferredNames.has(entry.name))
  return {
    tools: {
      ...Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [
          name,
          deferredNames.has(name) ? { ...tool, deferLoading: true } : tool
        ])
      ),
      [TOOL_SEARCH_TOOL_NAME]: createToolSearchTool(deferredEntries)
    },
    deferredEntries
  }
}
