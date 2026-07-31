/**
 * Composition hook returning the app's Streamdown `components` map — the rich
 * override set shared by chat messages and every off-chat markdown preview.
 *
 * Encapsulates everything that makes app markdown look the way it does:
 *   - `<a>`   → Link with citation routing (CitationTooltip vs Hyperlink card)
 *   - `<sup>` → CitationSup: tooltip for URL-less citations (knowledge/memory)
 *   - `<code>`→ CodeBlock with file-path detection + save action
 *   - `<table>`→ Table with copy/Excel export actions
 *   - `<img>` → ImageViewer with modal preview
 *   - `<pre>` → passthrough wrapper that preserves overflow:visible
 *   - `<p>`   → paragraph-with-image-escape (img inside p → div)
 *   - `<svg>` → MarkdownSvgRenderer (adaptive sizing + context menu)
 *   - `<style>` → MarkdownShadowDomRenderer (shadow DOM isolation)
 *
 * The returned map identity is memoized per render option, so
 * the generic `<Markdown>` / `<StreamingMarkdown>` upstream gets a stable
 * `components` prop reference across re-renders.
 */

import CitationSup from '@renderer/components/chat/messages/markdown/CitationSup'
import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import type { Citation } from '@renderer/types/message'
import { useMemo } from 'react'
import type { Components } from 'streamdown'

import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import Table from './Table'

interface Options {
  blockId: string
  /** Set true when the source contains a `<style>` element to enable shadow-DOM isolation. */
  hasStyleElement?: boolean
  /** True while the owning markdown block is still receiving stream chunks. */
  isStreaming?: boolean
  citationRegistry?: ReadonlyMap<number, Citation>
}

export function useMarkdownComponents({
  blockId,
  hasStyleElement = false,
  isStreaming = false,
  citationRegistry
}: Options): Partial<Components> {
  return useMemo(() => {
    const result: Partial<Components> = {
      a: (props: any) => <Link {...props} citationRegistry={citationRegistry} />,
      sup: (props: any) => <CitationSup {...props} citationRegistry={citationRegistry} />,
      code: (props: any) => <CodeBlock {...props} blockId={blockId} isStreaming={isStreaming} />,
      table: (props: any) => <Table {...props} blockId={blockId} />,
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      },
      svg: MarkdownSvgRenderer as Components['svg']
    }
    if (hasStyleElement) {
      result.style = MarkdownShadowDomRenderer as Components['style']
    }
    return result
  }, [blockId, citationRegistry, hasStyleElement, isStreaming])
}
