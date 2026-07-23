/**
 * Composition hook returning the chat-flavored Streamdown `components` map.
 *
 * Encapsulates everything that makes chat markdown look like chat markdown:
 *   - `<a>`   → Link with citation routing (CitationTooltip vs Hyperlink card)
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

import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import { useMemo } from 'react'
import type { Components } from 'streamdown'

import type { InlineHtmlPreviewMode } from './ChatMarkdown'
import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import Table from './Table'

interface Options {
  blockId: string
  /** Render assistant HTML fences inline, either as a placeholder or completed preview. */
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  /** Set true when the source contains a `<style>` element to enable shadow-DOM isolation. */
  hasStyleElement?: boolean
  /** True while the owning markdown block is still receiving stream chunks. */
  isStreaming?: boolean
}

export function useChatMarkdownComponents({
  blockId,
  inlineHtmlPreviewMode,
  hasStyleElement = false,
  isStreaming = false
}: Options): Partial<Components> {
  return useMemo(() => {
    const result: Partial<Components> = {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => (
        <CodeBlock
          {...props}
          blockId={blockId}
          inlineHtmlPreviewMode={inlineHtmlPreviewMode}
          isStreaming={isStreaming}
        />
      ),
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
  }, [blockId, hasStyleElement, inlineHtmlPreviewMode, isStreaming])
}
