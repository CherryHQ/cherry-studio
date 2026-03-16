import { catalog } from './catalog'

const JSON_RENDER_WRAPPER = `
IMPORTANT: When generating UI, you MUST wrap your JSONL output inside <json-render> tags like this:

<json-render>
{"op":"add","path":"/root","value":"main"}
{"op":"add","path":"/elements/main","value":{"type":"Card","props":{"title":"Hello World"},"children":[]}}
</json-render>

You can include normal text before and after the <json-render> block to explain the UI.
Do NOT use markdown code fences around the JSONL output — use <json-render> tags instead.
`

let cachedPrompt: string | null = null

/**
 * Returns the full json-render system prompt including catalog component definitions
 * and instructions to wrap output in <json-render> tags.
 *
 * Result is cached after first call since the catalog is static.
 */
export function getJsonRenderPrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = catalog.prompt() + '\n' + JSON_RENDER_WRAPPER
  }
  return cachedPrompt
}
