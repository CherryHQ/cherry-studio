import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'

const DEFERRED_TOOLS_HEADER = `<deferred-tools>
Some tools are not loaded inline. Discover and call them through the meta-tools below.

<usage>
1. \`tool_search({ query?, namespace?, verbose? })\` — discover tools, grouped by namespace (e.g. \`web\`, \`kb\`, \`mcp:<server>\`). This is tool discovery, NOT web search. Pass \`verbose: true\` to include full input schemas.
2. \`tool_inspect({ name })\` — fetch a tool JSDoc signature to confirm its parameter names and shapes. Optional, but inspecting first (or searching with \`verbose: true\`) saves a round-trip.
3. \`tool_invoke({ name, params })\` — call a single tool. If you call one you haven't inspected, or pass params that don't match its signature, the call returns that tool's signature — read it and call again with corrected params.
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
    counts.set(entry.namespace, (counts.get(entry.namespace) ?? 0) + 1)
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
