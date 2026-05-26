/**
 * Apply defer-based tool exposition to a per-request ToolSet.
 *
 * Decides which entries are deferred (via {@link shouldDefer}) and rebuilds
 * the ToolSet so the model sees:
 *   - non-deferred entries inline, exactly as before
 *   - `tool_search` + `tool_invoke` meta-tools when at least one entry is
 *     deferred, so the deferred set is still discoverable / callable
 *
 * Returns the deferred entries alongside the rebuilt ToolSet so callers
 * (system-prompt assembly, observability) can introspect what's hidden
 * behind the meta-tools without re-running `shouldDefer`.
 */

import type { ToolSet } from 'ai'

import { createToolInspectTool, TOOL_INSPECT_TOOL_NAME } from '../meta/toolInspect'
import { createToolInvokeTool, TOOL_INVOKE_TOOL_NAME } from '../meta/toolInvoke'
import { createToolSearchTool, TOOL_SEARCH_TOOL_NAME } from '../meta/toolSearch'
import type { ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { shouldDefer } from './shouldDefer'

export interface ApplyDeferExpositionResult {
  tools: ToolSet | undefined
  deferredEntries: ToolEntry[]
}

export function applyDeferExposition(
  tools: ToolSet | undefined,
  registry: ToolRegistry,
  contextWindow: number | undefined
): ApplyDeferExpositionResult {
  if (!tools || Object.keys(tools).length === 0) return { tools, deferredEntries: [] }

  const candidateEntries = Object.keys(tools)
    .map((name) => registry.getByName(name))
    .filter((e): e is NonNullable<typeof e> => e !== undefined)

  const { deferredNames } = shouldDefer(candidateEntries, contextWindow)
  if (deferredNames.size === 0) return { tools, deferredEntries: [] }

  const inlineTools: ToolSet = {}
  for (const [name, entry] of Object.entries(tools)) {
    if (!deferredNames.has(name)) inlineTools[name] = entry
  }
  inlineTools[TOOL_SEARCH_TOOL_NAME] = createToolSearchTool(registry, deferredNames)
  inlineTools[TOOL_INSPECT_TOOL_NAME] = createToolInspectTool(registry)
  inlineTools[TOOL_INVOKE_TOOL_NAME] = createToolInvokeTool(registry)
  // `tool_exec` (worker-thread JS sandbox with full registry access) is
  // intentionally NOT injected by default — it is a meaningful privilege-
  // escalation surface vs the renderer's prior restrictions. Re-enable
  // behind an explicit Preference key when there is a concrete need.
  const deferredEntries = candidateEntries.filter((e) => deferredNames.has(e.name))
  return { tools: inlineTools, deferredEntries }
}
