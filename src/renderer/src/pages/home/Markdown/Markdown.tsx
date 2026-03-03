import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
import 'remark-github-blockquote-alert/alert.css'
import 'streamdown/styles.css'

import { usePreference } from '@data/hooks/usePreference'
import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import type {
  CompactMessageBlock,
  MainTextMessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { isEmpty } from 'lodash'
import { type FC, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import remarkAlert from 'remark-github-blockquote-alert'
import { defaultUrlTransform, Streamdown } from 'streamdown'
import type { Pluggable } from 'unified'

import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import rehypeHeadingIds from './plugins/rehypeHeadingIds'
import rehypeScalableSvg from './plugins/rehypeScalableSvg'
import Table from './Table'

const SVG_ELEMENT_REGEX = /<svg[\s>]/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']
const ALLOWED_TAGS = { sup: ['data-citation'] }

interface Props {
  block: MainTextMessageBlock | TranslationMessageBlock | ThinkingMessageBlock | CompactMessageBlock
  // 可选的后处理函数，用于在流式渲染过程中处理文本（如引用标签转换）
  postProcess?: (text: string) => string
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const [mathEngine] = usePreference('chat.message.math.engine')
  const [mathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')

  const isStreaming = 'status' in block && block.status === 'streaming'

  const plugins = useMemo(() => {
    const result: Record<string, any> = {
      code,
      cjk,
      mermaid
    }
    // Streamdown only supports KaTeX; treat any non-'none' math engine as KaTeX
    if (mathEngine !== 'none') {
      result.math = createMathPlugin({ singleDollarTextMath: mathEnableSingleDollar })
    }
    return result
  }, [mathEngine, mathEnableSingleDollar])

  const remarkPlugins = useMemo(() => {
    return [remarkAlert as Pluggable]
  }, [])

  const messageContent = useMemo(() => {
    const content = postProcess ? postProcess(block.content) : block.content
    if ('status' in block && block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    return removeSvgEmptyLines(processLatexBrackets(content))
  }, [block, postProcess, t])

  const rehypePlugins = useMemo(() => {
    const result: Pluggable[] = []
    if (SVG_ELEMENT_REGEX.test(messageContent)) {
      result.push(rehypeScalableSvg)
    }
    result.push([rehypeHeadingIds, { prefix: `heading-${block.id}` }])
    return result
  }, [messageContent, block.id])

  // Fix #2: Move style tag check into useMemo to avoid mutating memoized object
  const components = useMemo(() => {
    const result: any = {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => <CodeBlock {...props} blockId={block.id} />,
      table: (props: any) => <Table {...props} blockId={block.id} />,
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props: any) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      },
      svg: MarkdownSvgRenderer
    }
    if (/<style\b[^>]*>/i.test(messageContent)) {
      result.style = MarkdownShadowDOMRenderer
    }
    return result
  }, [block.id, messageContent])

  const urlTransform = useCallback((url: string, key: string, node: any) => {
    if (url.startsWith('data:image/png') || url.startsWith('data:image/jpeg')) return url
    return defaultUrlTransform(url, key, node)
  }, [])

  // Fix #5: Memoize remarkRehypeOptions to avoid pipeline rebuild per render
  const remarkRehypeOptions = useMemo(
    () => ({
      footnoteLabel: t('common.footnotes'),
      footnoteLabelTagName: 'h4' as const,
      footnoteBackContent: ' '
    }),
    [t]
  )

  return (
    <div className="markdown">
      <Streamdown
        plugins={plugins}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        components={components}
        disallowedElements={DISALLOWED_ELEMENTS}
        urlTransform={urlTransform}
        isAnimating={isStreaming}
        normalizeHtmlIndentation
        remarkRehypeOptions={remarkRehypeOptions}
        allowedTags={ALLOWED_TAGS}>
        {messageContent}
      </Streamdown>
    </div>
  )
}

export default memo(Markdown)
