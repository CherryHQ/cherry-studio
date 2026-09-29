// Rich renderers (the Markdown pipeline, shiki tokenization) run on the renderer main thread over
// the whole document, so a big text preview falls back to the virtualized plain-text viewer above these budgets.
const RICH_TEXT_PREVIEW_MAX_SIZE_BYTES = 1024 * 1024

const RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS = 5000

/** Line count without materializing the line array, and without a trailing newline counting twice. */
function countLines(content: string): number {
  if (content.length === 0) return 0
  let newlines = 0
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) newlines++
  }
  return content.endsWith('\n') ? newlines : newlines + 1
}

function hasHighRatioOfLongLines(content: string): boolean {
  const lines = countLines(content)
  if (lines === 0) return false
  return content.length / lines > RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS
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
