import type { ToolEntry } from '../tools/types'

const DEFERRED_TOOLS_HEADER = `<deferred-tools>
Some tools are not loaded inline. Discover and call them through the meta-tools below.

<usage>
1. \`tool_search({ query?, namespace?, verbose? })\` — browse the catalog. Results are grouped by namespace (e.g. \`web\`, \`kb\`, \`mcp:<server>\`). Pass \`verbose: true\` to include full input schemas.
2. \`tool_inspect({ name })\` — fetch a JSDoc stub for one tool when the search description isn't enough to call it confidently.
3. \`tool_invoke({ name, params })\` — call a single tool you found.
4. \`tool_exec({ code })\` — run JavaScript that orchestrates many tool calls in one round. Globals: \`tools.invoke(name, params)\`, \`parallel(...)\`, \`settle(...)\`, \`console.*\`, \`tools.log(level, msg, fields?)\`. You MUST \`return\` the final value. Prefer this over many \`tool_invoke\` round-trips when fan-out / aggregation is needed.
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
