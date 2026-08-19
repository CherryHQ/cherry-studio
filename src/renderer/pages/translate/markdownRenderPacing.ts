/**
 * Pacing for the Translate page's markdown rendering while the smooth-stream
 * rAF loop emits frames; mirrors HtmlArtifactView's streaming preview pacing.
 */

export const MARKDOWN_RENDER_MIN_INTERVAL_MS = 250
export const MARKDOWN_RENDER_MAX_INTERVAL_MS = 4000
// Calibrated to measured update cost (~10-30ms per committed render at 1-7k
// chars incl. layout): len/15 keeps render occupancy low for long documents.
export const MARKDOWN_RENDER_CHARS_PER_MS = 15
/** Consecutive content changes closer than this are stream frames, not swaps. */
export const MARKDOWN_RENDER_STREAM_CADENCE_MS = 120

/**
 * Full adaptive interval for `content` (the wait after a fresh commit).
 */
export function markdownRenderInterval(content: string): number {
  return Math.min(
    MARKDOWN_RENDER_MAX_INTERVAL_MS,
    Math.max(MARKDOWN_RENDER_MIN_INTERVAL_MS, content.length / MARKDOWN_RENDER_CHARS_PER_MS)
  )
}

/**
 * Delay (ms) before the next markdown render of `content`.
 * Content changes that follow the previous change within one playout cadence
 * are stream frames and wait for the adaptive interval (growing with document
 * length); discrete swaps, first frames, and re-render triggers (theme switch,
 * markdown toggle — unchanged content) render immediately. Returning 0 means
 * "render now"; the caller's trailing timer guarantees the final stream state
 * is always rendered — including the post-stream drain tail, which still
 * changes content every ~16ms and therefore stays paced.
 */
export function nextMarkdownRenderDelay(
  content: string,
  previousContent: string | undefined,
  lastRenderAt: number,
  now: number,
  lastContentChangeAt?: number
): number {
  if (content === previousContent) return 0
  if (lastContentChangeAt === undefined || now - lastContentChangeAt > MARKDOWN_RENDER_STREAM_CADENCE_MS) return 0
  return Math.max(0, markdownRenderInterval(content) - (now - lastRenderAt))
}
