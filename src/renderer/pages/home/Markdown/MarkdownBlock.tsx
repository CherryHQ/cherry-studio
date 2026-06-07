import { type ComponentProps, memo, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { Pluggable, PluggableList } from 'unified'

type RemarkRehypeOptions = NonNullable<ComponentProps<typeof ReactMarkdown>['remarkRehypeOptions']>

import rehypeHeadingIds from './plugins/rehypeHeadingIds'

interface Props {
  /** One top-level markdown block (from `splitMarkdownBlocks`). */
  text: string
  /**
   * Block index within the message. Used only to build a unique
   * `rehypeHeadingIds` prefix so heading anchors don't collide across
   * blocks and stay deterministic per position.
   */
  index: number
  /** `block.id` of the owning message — anchor-id namespace. */
  blockId: string
  /** Stable across chunks — see Markdown.tsx memoization. */
  remarkPlugins: PluggableList
  /** Stable base rehype chain WITHOUT heading-ids (appended here per block). */
  rehypeBasePlugins: PluggableList
  /** Stable across chunks. */
  components: Partial<Components>
  /** Stable across chunks. */
  urlTransform: (value: string) => string
  /** Stable across chunks. */
  remarkRehypeOptions: RemarkRehypeOptions
  disallowedElements: string[]
}

/**
 * A single memoized markdown block.
 *
 * Why this exists: `<ReactMarkdown>` has no incremental parsing — feeding it a
 * growing string re-runs the full remark→rehype→React pipeline + reconcile
 * every chunk (O(n²) per streamed message). By splitting the message into
 * top-level blocks and rendering each through its own `memo`'d instance, only
 * the trailing (still-growing) block re-parses per frame; completed blocks
 * have byte-identical `text` so `React.memo`'s shallow compare skips them
 * entirely. Every other prop is referentially stable across chunks (enforced
 * by the memoization in Markdown.tsx) so the shallow compare turns on `text`.
 */
const MarkdownBlock = ({
  text,
  index,
  blockId,
  remarkPlugins,
  rehypeBasePlugins,
  components,
  urlTransform,
  remarkRehypeOptions,
  disallowedElements
}: Props) => {
  const rehypePlugins = useMemo<PluggableList>(
    () => [...rehypeBasePlugins, [rehypeHeadingIds, { prefix: `heading-${blockId}-${index}` }] as Pluggable],
    [rehypeBasePlugins, blockId, index]
  )

  return (
    <ReactMarkdown
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      components={components}
      disallowedElements={disallowedElements}
      urlTransform={urlTransform}
      remarkRehypeOptions={remarkRehypeOptions}>
      {text}
    </ReactMarkdown>
  )
}

export default memo(MarkdownBlock)
