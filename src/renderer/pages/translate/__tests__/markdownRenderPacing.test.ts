import { describe, expect, it } from 'vitest'

import {
  MARKDOWN_RENDER_CHARS_PER_MS,
  MARKDOWN_RENDER_MAX_INTERVAL_MS,
  MARKDOWN_RENDER_MIN_INTERVAL_MS,
  MARKDOWN_RENDER_STREAM_CADENCE_MS,
  nextMarkdownRenderDelay
} from '../markdownRenderPacing'

const FRAME_GAP_MS = 16

describe('nextMarkdownRenderDelay', () => {
  it('renders immediately when no render has happened yet', () => {
    expect(nextMarkdownRenderDelay('hello', undefined, 0, 5_000, 4_984)).toBe(0)
  })

  it('renders immediately when the content did not change (theme or toggle re-render)', () => {
    const now = Date.now()
    expect(nextMarkdownRenderDelay('hello', 'hello', now, now, now - FRAME_GAP_MS)).toBe(0)
  })

  it('renders immediately for a discrete swap whose previous change is older than one cadence', () => {
    const now = Date.now()
    expect(
      nextMarkdownRenderDelay('history item', 'stream tail', now - 1, now, now - MARKDOWN_RENDER_STREAM_CADENCE_MS - 1)
    ).toBe(0)
  })

  it('paces stream frames (previous change within one cadence) to the minimum interval', () => {
    const now = Date.now()
    expect(nextMarkdownRenderDelay('a longer paragraph', 'a longer paragrap', now, now, now - FRAME_GAP_MS)).toBe(
      MARKDOWN_RENDER_MIN_INTERVAL_MS
    )
  })

  it('still paces the post-stream drain tail even though the upstream stream has ended', () => {
    const now = Date.now()
    expect(nextMarkdownRenderDelay('tail frame 2', 'tail frame 1', now, now, now - FRAME_GAP_MS)).toBe(
      MARKDOWN_RENDER_MIN_INTERVAL_MS
    )
  })

  it('grows the interval with document length and caps it at the maximum', () => {
    const now = Date.now()
    const large = 'x'.repeat(MARKDOWN_RENDER_CHARS_PER_MS * (MARKDOWN_RENDER_MAX_INTERVAL_MS + 10))
    expect(nextMarkdownRenderDelay(large, '', now, now, now - FRAME_GAP_MS)).toBe(MARKDOWN_RENDER_MAX_INTERVAL_MS)
  })

  it('spaces out long documents: a 6k-char stream frame waits 400ms', () => {
    const now = Date.now()
    expect(nextMarkdownRenderDelay('x'.repeat(6000), '', now, now, now - FRAME_GAP_MS)).toBe(400)
  })

  it('renders immediately once the interval has fully elapsed since the last render', () => {
    const now = Date.now()
    expect(
      nextMarkdownRenderDelay('changed', 'previous', now - MARKDOWN_RENDER_MIN_INTERVAL_MS - 1, now, now - FRAME_GAP_MS)
    ).toBe(0)
  })
})
