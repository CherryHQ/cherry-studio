import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { RehypePluginName, useRehypePlugins } from '@renderer/context/MarkdownPluginProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Message } from '@renderer/types'
import { parseJSON } from '@renderer/utils'
import { escapeBrackets, removeSvgEmptyLines, withGeminiGrounding } from '@renderer/utils/formats'
import { findCitationInChildren } from '@renderer/utils/markdown'
import { isEmpty } from 'lodash'
import { type FC, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import CodeBlock from './CodeBlock'
import ImagePreview from './ImagePreview'
import Link from './Link'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup)/i

interface Props {
  message: Message
}

const remarkPlugins = [remarkMath, remarkGfm, remarkCjkFriendly]
const disallowedElements = ['iframe']
const Markdown: FC<Props> = ({ message }) => {
  const { t } = useTranslation()
  const { renderInputMessageAsMarkdown, mathEngine } = useSettings()

  const messageContent = useMemo(() => {
    const empty = isEmpty(message.content)
    const paused = message.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : withGeminiGrounding(message)
    return removeSvgEmptyLines(escapeBrackets(content))
  }, [message, t])

  const needHtml = useMemo(() => {
    return ALLOWED_ELEMENTS.test(messageContent)
  }, [messageContent])

  // 决定需要加载哪些rehype插件
  const neededRehypePlugins = useMemo(() => {
    const plugins: RehypePluginName[] = []

    plugins.push(mathEngine === 'KaTeX' ? 'rehype-katex' : 'rehype-mathjax')

    if (needHtml) {
      plugins.push('rehype-raw')
    }

    return plugins
  }, [mathEngine, needHtml])

  // 加载所需的rehype插件
  const rehypePlugins = useRehypePlugins(neededRehypePlugins)

  const components = useMemo(() => {
    const baseComponents = {
      a: (props: any) => <Link {...props} citationData={parseJSON(findCitationInChildren(props.children))} />,
      code: CodeBlock,
      img: ImagePreview,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />
    } as Partial<Components>
    return baseComponents
  }, [])

  if ((message.role === 'user' && !renderInputMessageAsMarkdown) || rehypePlugins.length === 0) {
    return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
  }

  if (messageContent.includes('<style>')) {
    components.style = MarkdownShadowDOMRenderer as any
  }

  return (
    <ReactMarkdown
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      className="markdown"
      components={components}
      disallowedElements={disallowedElements}
      remarkRehypeOptions={{
        footnoteLabel: t('common.footnotes'),
        footnoteLabelTagName: 'h4',
        footnoteBackContent: ' '
      }}>
      {messageContent}
    </ReactMarkdown>
  )
}

export default memo(Markdown)
