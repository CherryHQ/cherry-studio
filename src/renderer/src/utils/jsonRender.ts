/**
 * Pre-processor for json-render blocks in markdown content.
 *
 * Converts `<json-render>...</json-render>` tags (and unclosed streaming tags)
 * into fenced code blocks with language `json-render`, so they flow through
 * the existing CodeBlock routing in the markdown pipeline.
 */

// Matches a complete <json-render>...</json-render> block
const COMPLETE_BLOCK_RE = /<json-render>([\s\S]*?)<\/json-render>/g

// Matches an unclosed <json-render> tag (streaming state — no closing tag yet)
const UNCLOSED_BLOCK_RE = /<json-render>([\s\S]*)$/

/**
 * Extracts `<json-render>` blocks from markdown content and replaces them
 * with fenced code blocks using language `json-render`.
 *
 * During streaming, unclosed tags produce an open code fence (no closing ```)
 * so that `isOpenFenceBlock()` in CodeBlock.tsx returns `true`.
 *
 * Follows the same protection pattern as `processLatexBrackets` in
 * `src/renderer/src/utils/markdown.ts`.
 */
export function preprocessJsonRender(content: string): string {
  if (!content.includes('<json-render>')) {
    return content
  }

  // Step 1: Protect existing code blocks from false matches
  const protectedItems: string[] = []
  let processed = content.replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
    const index = protectedItems.length
    protectedItems.push(match)
    return `__JSON_RENDER_PROTECTED_${index}__`
  })

  // Step 2: Replace complete <json-render>...</json-render> blocks
  processed = processed.replace(COMPLETE_BLOCK_RE, (_match, inner: string) => {
    return '```json-render\n' + inner.trim() + '\n```'
  })

  // Step 3: Replace unclosed <json-render> block (streaming) — open fence only
  processed = processed.replace(UNCLOSED_BLOCK_RE, (_match, inner: string) => {
    return '```json-render\n' + inner.trim()
  })

  // Step 4: Restore protected code blocks
  for (let i = 0; i < protectedItems.length; i++) {
    processed = processed.replace(`__JSON_RENDER_PROTECTED_${i}__`, protectedItems[i])
  }

  return processed
}
