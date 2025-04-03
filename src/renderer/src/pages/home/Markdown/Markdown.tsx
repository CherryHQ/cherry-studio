import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'

import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Message } from '@renderer/types'
import { escapeBrackets, removeSvgEmptyLines, withGeminiGrounding } from '@renderer/utils/formats'
import { isEmpty } from 'lodash'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore next-line
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
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
  citationsData?: Map<
    string,
    {
      url: string
      title?: string
      content?: string
    }
  >
}

const remarkPlugins = [remarkMath, remarkGfm, remarkCjkFriendly]
const disallowedElements = ['iframe']
const Markdown: FC<Props> = ({ message, citationsData }) => {
  const { t } = useTranslation()
  const { renderInputMessageAsMarkdown, mathEngine } = useSettings()

  const rehypeMath = useMemo(() => (mathEngine === 'KaTeX' ? rehypeKatex : rehypeMathjax), [mathEngine])

  const messageContent = useMemo(() => {
    const empty = isEmpty(message.content)
    const paused = message.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : withGeminiGrounding(message)
    return removeSvgEmptyLines(escapeBrackets(content))
  }, [message, t])

  const rehypePlugins = useMemo(() => {
    const hasElements = ALLOWED_ELEMENTS.test(messageContent)
    return hasElements ? [rehypeRaw, rehypeMath] : [rehypeMath]
  }, [messageContent, rehypeMath])

  const components = useMemo(() => {
    const baseComponents = {
      a: (props: any) => {
        if (props.href && citationsData?.has(props.href)) {
          return <Link {...props} citationData={citationsData.get(props.href)} />
        }
        return <Link {...props} />
      },
      code: CodeBlock,
      img: ImagePreview,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      style: MarkdownShadowDOMRenderer as any
    } as Partial<Components>
    return baseComponents
  }, [citationsData])

  if (message.role === 'user' && !renderInputMessageAsMarkdown) {
    return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
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

export default Markdown
