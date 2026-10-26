import '@cherrystudio/ui/components/composites/markdown/styles'
import { use, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'
import type { Pluggable } from 'unified'

import {
  createCodeHighlightPlugin,
  defaultMarkdownPlugins,
  Markdown,
  forgetStreamingMarkdownAnimations,
  type MarkdownAnimationRecovery,
  StreamingMarkdown,
  withMath
} from '@cherrystudio/ui'
import { CodeStyleContext } from '@renderer/hooks/useCodeStyle'
import { codeHighlightService } from '@renderer/services/CodeHighlightService'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import { useMarkdownComponents } from './MarkdownRenderers'
import { createLatexMarkdownBlockParser } from './parseLatexMarkdownBlocks'
import { remarkLiteralAutolinkFix } from './remarkLiteralAutolinkFix'
import { useMarkdownHost } from './useMarkdownHost'
import { MarkdownStreamingContext } from './useMarkdownStreaming'

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
}

const REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath]
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

export function AppMarkdown(props: AppMarkdownProps) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const isStreaming = props.isStreaming ?? false
  const recovery = props.id ? { id: props.id, source: props.children, isStreaming } : undefined
  useEffect(() => {
    if (props.id && !isStreaming) forgetStreamingMarkdownAnimations((candidate) => candidate === props.id)
  }, [props.id, isStreaming])
  return <MarkdownContent key={id} {...props} id={id} animationRecovery={recovery} />
}

function MarkdownContent({
  children,
  id,
  animationRecovery,
  isStreaming = false,
  singleDollarMath = true,
  className,
  components,
  remarkPlugins,
  rehypePlugins,
  transformSource = removeSvgEmptyLines
}: AppMarkdownProps & { id: string; animationRecovery?: MarkdownAnimationRecovery }) {
  const { t } = useTranslation()
  const { openFilePath, resolveImageSrc } = useMarkdownHost()
  const [hasStreamed, setHasStreamed] = useState(isStreaming)
  if (isStreaming && !hasStreamed) setHasStreamed(true)

  const parseMarkdownBlocks = useMemo(createLatexMarkdownBlockParser, [])
  const codeStyle = use(CodeStyleContext)
  const code = useMemo(
    () => createCodeHighlightPlugin({ execute: codeHighlightService.highlightSnapshot, themes: codeStyle?.codeThemes }),
    [codeStyle?.codeThemes]
  )
  const plugins = useMemo(
    () => ({ ...defaultMarkdownPlugins, code, math: withMath({ singleDollar: singleDollarMath }) }),
    [singleDollarMath, code]
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

  return (
    <MarkdownStreamingContext value={isStreaming}>
      {hasStreamed || isStreaming ? (
        <StreamingMarkdown
          {...commonProps}
          animationRecovery={animationRecovery}
          animated={isStreaming && content.length <= MAX_ANIMATED_CONTENT_LENGTH ? undefined : false}
          parseIncompleteMarkdown={isStreaming}
          parseMarkdownIntoBlocksFn={parseMarkdownBlocks}>
          {content}
        </StreamingMarkdown>
      ) : (
        <Markdown {...commonProps} preserveRelativeImageSrcs={Boolean(resolveImageSrc)}>
          {content}
        </Markdown>
      )}
    </MarkdownStreamingContext>
  )
}
