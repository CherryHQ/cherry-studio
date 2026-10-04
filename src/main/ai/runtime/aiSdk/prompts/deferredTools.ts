import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'

const DEFERRED_TOOLS_HEADER = `<deferred-tools>
Some tool definitions are loaded on demand.

<usage>
1. \`tool_search({ query: "..." })\` — search tool names, descriptions, or a namespace listed below. Use a nonempty substring; this searches tools, not the web.
2. Wait for the next model step: matching tool definitions become available then. Searching does not allow a previously unavailable tool to execute in the same step or code program.
3. Call a discovered tool directly using its provided schema, or through Code Mode when its catalog allows it. Search again with a more specific query if the desired tool is missing.
</usage>`

/**
 * Build the deferred-tools system-prompt section. Includes a per-namespace
 * inventory so the model knows where to drill down without an exploratory
 * `tool_search()` round-trip.
 *
 * Wrapped in XML tags for parser-friendly structure (recommended by
 * Anthropic; tolerated well by other providers).
 */
export function getDeferredToolsSystemPrompt(deferredEntries: readonly ToolEntry[] = []): string {
  if (deferredEntries.length === 0) return `${DEFERRED_TOOLS_HEADER}\n</deferred-tools>`

  const counts = new Map<string, number>()
  for (const entry of deferredEntries) {
    // Label, not `namespace` — MCP namespaces are opaque server ids.
    const label = entry.namespaceLabel ?? entry.namespace
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const lines = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ns, n]) => `  <namespace name="${ns}" count="${n}"/>`)

  return `${DEFERRED_TOOLS_HEADER}

<namespaces>
${lines.join('\n')}
</namespaces>
</deferred-tools>`
}
