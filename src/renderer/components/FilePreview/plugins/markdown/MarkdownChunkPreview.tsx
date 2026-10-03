import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

import { StaticMarkdown } from '@renderer/components/markdown'

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

  // The viewer owns the scroll here: its virtualizer measures its own scroller, so an unbounded
  // wrapper would hand it the whole document as the viewport and mount every chunk.
  return (
    <div className="flex h-full min-h-0 w-full">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto pb-[var(--chat-composer-inset,0px)]">
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
