/**
 * Inline-citation guidance, appended to the system prompt only when a
 * citable lookup tool (web_search / web_fetch / kb_search / kb_read) is exposed
 * to the model — inline or deferred behind `tool_search`. The `[cite:id]`
 * markers it mandates are resolved by the renderer against the message's own
 * tool results (see `src/renderer/utils/message/citations.ts`).
 *
 * Wrapped in XML tags for parser-friendly structure (recommended by
 * Anthropic; tolerated well by other providers).
 */
export const CITATIONS_SYSTEM_PROMPT = `<citations>
When a statement in your answer is based on a web_search, web_fetch, kb_search, or kb_read result, append a citation marker immediately after that statement: [cite:ID], where ID is the exact \`id\` field of the supporting result item.
- Example: "Cherry Studio 2.0 entered beta in May. [cite:3f2a1b9c-2]"
- Chain markers when several results support one statement: [cite:3f2a1b9c-1][cite:7d4e0a51-3]
- Copy ids exactly as returned by the tool. Never invent, renumber, or reuse ids from other results.
- Do not add a "References" or "Sources" section at the end — the app renders citations from the inline markers.
- Statements from your own knowledge take no marker.
</citations>`
