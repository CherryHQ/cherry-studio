import '@cherrystudio/ui/components/composites/markdown/styles'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'
import type { Pluggable } from 'unified'

import { defaultMarkdownPlugins, Markdown, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import { useMarkdownComponents } from './MarkdownRenderers'
import { copyComposedParagraphs } from './paragraphCopy'
import { createLatexMarkdownBlockParser } from './parseLatexMarkdownBlocks'
import { remarkLiteralAutolinkFix } from './remarkLiteralAutolinkFix'
import { useMarkdownHost } from './useMarkdownHost'
import { MarkdownStreamingContext } from './useMarkdownStreaming'
import { ParagraphLayoutContext } from './useParagraphLayout'

export interface AppMarkdownProps {
  children: string
  /** Content identity. Changing it resets renderer state and the block parser. */
  id?: string
  isStreaming?: boolean
  singleDollarMath?: boolean
  className?: string
  components?: Partial<Components>
  remarkPlugins?: Pluggable[]
  rehypePlugins?: Pluggable[]
  /** Replaces default source cleanup when the host protects embedded content. */
  transformSource?: (source: string) => string
  paragraphLayout?: 'native' | 'justified'
}

const REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath]
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

export function AppMarkdown(props: AppMarkdownProps) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  return <MarkdownContent key={id} {...props} id={id} />
}

function MarkdownContent({
  children,
  id,
  isStreaming = false,
  singleDollarMath = true,
  className,
  components,
  remarkPlugins,
  rehypePlugins,
  transformSource = removeSvgEmptyLines,
  paragraphLayout = 'native'
}: AppMarkdownProps & { id: string }) {
  const { t } = useTranslation()
  const { openFilePath } = useMarkdownHost()
  const [hasStreamed, setHasStreamed] = useState(isStreaming)
  if (isStreaming && !hasStreamed) setHasStreamed(true)

  const parseMarkdownBlocks = useMemo(createLatexMarkdownBlockParser, [])
  const plugins = useMemo(
    () => ({ ...defaultMarkdownPlugins, math: withMath({ singleDollar: singleDollarMath }) }),
    [singleDollarMath]
  )
  const content = useMemo(
    () => (isStreaming && children.length > MAX_STREAMING_TRANSFORM_LENGTH ? children : transformSource(children)),
    [children, isStreaming, transformSource]
  )
  const resolvedRemarkPlugins = useMemo(
    () => (remarkPlugins ? [...REMARK_PLUGINS, ...remarkPlugins] : REMARK_PLUGINS),
    [remarkPlugins]
  )
  const markdownComponents = useMarkdownComponents({ components, hasStyleElement: /<style\b[^>]*>/i.test(content) })
  const commonProps = {
    id,
    plugins,
    components: markdownComponents,
    remarkPlugins: resolvedRemarkPlugins,
    rehypePlugins,
    className,
    footnoteLabel: t('common.footnotes'),
    preserveFileLinkHrefs: Boolean(openFilePath)
  }

  const markdown = (
    <MarkdownStreamingContext value={isStreaming}>
      {hasStreamed || isStreaming ? (
        <StreamingMarkdown
          {...commonProps}
          animated={isStreaming && content.length <= MAX_ANIMATED_CONTENT_LENGTH ? undefined : false}
          parseIncompleteMarkdown={isStreaming}
          parseMarkdownIntoBlocksFn={parseMarkdownBlocks}>
          {content}
        </StreamingMarkdown>
      ) : (
        <Markdown {...commonProps}>{content}</Markdown>
      )}
    </MarkdownStreamingContext>
  )
  return paragraphLayout === 'justified' ? (
    <ParagraphLayoutContext value={!isStreaming}>
      <div className="contents" onCopy={copyComposedParagraphs}>
        {markdown}
      </div>
    </ParagraphLayoutContext>
  ) : (
    markdown
  )
}
