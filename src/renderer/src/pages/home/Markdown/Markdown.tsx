import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'

import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Message } from '@renderer/types'
import { escapeBrackets, removeSvgEmptyLines, withGeminiGrounding } from '@renderer/utils/formats'
import { isEmpty } from 'lodash'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore next-line
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
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

const Markdown: FC<Props> = ({ message }) => {
  const { t } = useTranslation()
  const { renderInputMessageAsMarkdown, mathEngine } = useSettings()
  const rehypeMath = useMemo(() => (mathEngine === 'KaTeX' ? rehypeKatex : rehypeMathjax), [mathEngine])

  const messageContent = useMemo(() => {
    const empty = isEmpty(message.content)
    const paused = message.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : withGeminiGrounding(message)
    return removeSvgEmptyLines(escapeBrackets(content))
  }, [message, t])

  const [displayText, setDisplayText] = useState(message.role === 'assistant' ? messageContent : '')
  const typeWriterIndex = useRef(0)
  const messageStatus = useRef(message.status)
  const rafIdRef = useRef<number | null>(null)

  const raf = useCallback(() => {
    if (typeWriterIndex.current < messageContent.length) {
      setDisplayText(messageContent.slice(0, typeWriterIndex.current + 1))
      typeWriterIndex.current += 1
      rafIdRef.current = requestAnimationFrame(raf)
    }
  }, [messageContent])

  useEffect(() => {
    // 只对助手消息进行处理
    if (message.role !== 'assistant') {
      setDisplayText(messageContent)
      return
    }

    // 检查是否需要继续或开始动画
    const shouldAnimate =
      // 状态为 pending
      message.status === 'pending' ||
      // 或者状态从 pending 变为其他，但动画尚未完成
      (messageStatus.current === 'pending' &&
        message.status !== 'pending' &&
        typeWriterIndex.current < messageContent.length)

    // 更新状态引用
    messageStatus.current = message.status

    // 如果需要动画
    if (shouldAnimate) {
      // 如果是新消息或者内容变化，重置索引
      if (typeWriterIndex.current === 0 || typeWriterIndex.current >= messageContent.length) {
        typeWriterIndex.current = 0
      }
      // 开始或继续动画
      raf()
    } else {
      // 显示完整内容
      setDisplayText(messageContent)
    }

    // 清理函数
    return () => {
      rafIdRef.current && cancelAnimationFrame(rafIdRef.current)
    }
  }, [messageContent, message.role, message.status, raf])

  const rehypePlugins = useMemo(() => {
    const hasElements = ALLOWED_ELEMENTS.test(messageContent)
    return hasElements ? [rehypeRaw, rehypeMath] : [rehypeMath]
  }, [messageContent, rehypeMath])

  const components = useCallback(() => {
    const baseComponents = {
      a: Link,
      code: CodeBlock,
      img: ImagePreview
    } as Partial<Components>

    if (messageContent.includes('<style>')) {
      baseComponents.style = MarkdownShadowDOMRenderer as any
    }

    return baseComponents
  }, [messageContent])

  if (message.role === 'user' && !renderInputMessageAsMarkdown) {
    return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
  }

  return (
    <ReactMarkdown
      rehypePlugins={rehypePlugins}
      remarkPlugins={[remarkMath, remarkGfm]}
      className="markdown"
      components={components()}
      remarkRehypeOptions={{
        footnoteLabel: t('common.footnotes'),
        footnoteLabelTagName: 'h4',
        footnoteBackContent: ' '
      }}>
      {displayText}
    </ReactMarkdown>
  )
}

export default Markdown
