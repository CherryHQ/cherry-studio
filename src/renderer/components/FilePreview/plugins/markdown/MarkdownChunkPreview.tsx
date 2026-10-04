import { useVirtualizer } from '@tanstack/react-virtual'
import { type MouseEvent as ReactMouseEvent, useRef } from 'react'

import { findMarkdownAnchorTarget, StaticMarkdown } from '@renderer/components/markdown'

import type { MarkdownChunk } from './markdownChunks'

// Markdown source lines render taller than code lines — wrapped prose, headings and table rows all
// exceed one line box. The virtualizer corrects each chunk after it has been measured once.
const ESTIMATED_CHUNK_LINE_PX = 30

interface MarkdownChunkPreviewProps {
  /** The document already split; the caller owns that single pass over the source. */
  chunks: MarkdownChunk[]
  /** Stable identity; every chunk derives its own heading-ID prefix from it. */
  id: string
}

/**
 * Windowed Markdown preview: only the chunks intersecting the viewport are mounted, so a large
 * document never pays a whole-file parse and layout in one frame and the first screenful is ready
 * as soon as those chunks have rendered.
 */
export function MarkdownChunkPreview({ chunks, id }: MarkdownChunkPreviewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollerRef.current,
    getItemKey: (index) => `${id}:${index}`,
    estimateSize: (index) => chunks[index].lines * ESTIMATED_CHUNK_LINE_PX,
    overscan: 2
  })
  const virtualItems = virtualizer.getVirtualItems()

  // Every chunk renders its own `.markdown` container, so the default anchor handler — which
  // scopes to the nearest one — cannot see a heading that lives in a different chunk. Resolving
  // against the scroller covers the whole preview; a chunk the virtualizer has not mounted still
  // has no element to find, and the event is left to the default handler in that case.
  const scrollToPreviewAnchor = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    const href = anchor?.getAttribute('href')
    if (!href?.startsWith('#')) return

    let fragment: string
    try {
      fragment = decodeURIComponent(href.slice(1))
    } catch {
      return
    }
    if (!fragment) return

    const target = findMarkdownAnchorTarget(scrollerRef.current, fragment)
    if (!target) return

    event.preventDefault()
    event.stopPropagation()
    target.scrollIntoView({ block: 'start' })
  }

  // The viewer owns the scroll here: its virtualizer measures its own scroller, so an unbounded
  // wrapper would hand it the whole document as the viewport and mount every chunk.
  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        ref={scrollerRef}
        onClickCapture={scrollToPreviewAnchor}
        className="min-h-0 flex-1 overflow-y-auto pb-[var(--chat-composer-inset,0px)]">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          <div
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}>
            {virtualItems.map((item) => (
              <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
                <div className="mx-auto w-full max-w-4xl px-4 pt-4">
                  <StaticMarkdown id={`${id}:${item.index}`}>{chunks[item.index].text}</StaticMarkdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
