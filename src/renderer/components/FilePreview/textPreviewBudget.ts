// Rich renderers (the Markdown pipeline, shiki tokenization) run on the renderer main thread over
// the whole document, so a big text preview falls back to the virtualized plain-text viewer above these budgets.
const RICH_TEXT_PREVIEW_MAX_SIZE_BYTES = 1024 * 1024

const RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS = 5000

/** Line count and content length without materializing the line array. */
function measureLines(content: string): { lines: number; contentChars: number } {
  if (content.length === 0) return { lines: 0, contentChars: 0 }
  let newlines = 0
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) newlines++
  }
  // A trailing newline terminates its line rather than starting a second one.
  return { lines: content.endsWith('\n') ? newlines : newlines + 1, contentChars: content.length - newlines }
}

function hasHighRatioOfLongLines(content: string): boolean {
  const { lines, contentChars } = measureLines(content)
  if (lines === 0) return false
  // The newline separators are not content, so a 5,000-character line lands on the limit, not past it.
  return contentChars / lines > RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS
}

/**
 * Whether a text document is cheap enough to run through a rich renderer.
 *
 * @param sizeBytes - Preflighted file size, in bytes.
 * @param content - The already-read file content.
 */
export function shouldRenderRichTextPreview(sizeBytes: number, content: string): boolean {
  return sizeBytes <= RICH_TEXT_PREVIEW_MAX_SIZE_BYTES && !hasHighRatioOfLongLines(content)
}
