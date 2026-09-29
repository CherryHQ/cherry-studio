// Rich renderers (the Markdown pipeline, shiki tokenization) run on the renderer main thread over
// the whole document, so a big text preview falls back to the virtualized plain-text viewer above these budgets.
const RICH_TEXT_PREVIEW_MAX_SIZE_BYTES = 1024 * 1024

const RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS = 5000

function hasHighRatioOfLongLines(content: string): boolean {
  if (content.length === 0) return false
  return content.length / content.split('\n').length > RICH_TEXT_PREVIEW_MAX_AVERAGE_LINE_CHARS
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
