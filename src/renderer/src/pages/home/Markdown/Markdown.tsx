import 'katex/dist/katex.min.css'

import { useSettings } from '@renderer/hooks/useSettings'
import { Message, Topic } from '@renderer/types'
import { escapeBrackets, removeSvgEmptyLines, withGeminiGrounding } from '@renderer/utils/formats'
import { isEmpty } from 'lodash'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore next-line
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import CodeBlock from './CodeBlock'
import ImagePreview from './ImagePreview'
import Link from './Link'
import TopicReference from './TopicReference'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup)/i

interface Props {
  message: Message
  currentTopic: Topic
}

const Markdown: FC<Props> = ({ message, currentTopic }) => {
  const { t } = useTranslation()
  const { renderInputMessageAsMarkdown, mathEngine } = useSettings()

  const rehypeMath = mathEngine === 'KaTeX' ? rehypeKatex : rehypeMathjax

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

  // 处理主题引用格式: [[主题名称]|[主题ID]]
  const processedContent = useMemo(() => {
    if (message.role === 'user' && !renderInputMessageAsMarkdown) {
      // 正则表达式匹配主题引用格式
      const regex = /\[\[([^\]|]+)\]\|\[([^\]|]+)\]\]/g
      let lastIndex = 0
      const parts = []
      let match

      // 复制原始内容用于处理
      const contentCopy = messageContent

      // 查找所有匹配
      while ((match = regex.exec(contentCopy)) !== null) {
        // 添加匹配前的文本
        if (match.index > lastIndex) {
          parts.push(contentCopy.substring(lastIndex, match.index))
        }

        // 解析主题名称和ID
        const [fullMatch, topicName, topicId] = match

        // 添加 TopicReference 组件
        parts.push(
          <TopicReference
            key={`topic-${topicId}-${match.index}`}
            topicName={topicName}
            topicId={topicId}
            currentTopic={currentTopic}
          />
        )

        lastIndex = match.index + fullMatch.length
      }

      // 添加剩余文本
      if (lastIndex < contentCopy.length) {
        parts.push(contentCopy.substring(lastIndex))
      }

      // 如果找到了主题引用，返回处理后的数组
      if (parts.length > 1) {
        return parts
      }
    }

    // 默认情况下返回原始内容
    return messageContent
  }, [message.role, renderInputMessageAsMarkdown, messageContent, currentTopic])

  // 用户消息且不渲染Markdown时的特殊处理
  if (message.role === 'user' && !renderInputMessageAsMarkdown) {
    // 如果有主题引用，使用处理后的内容
    if (Array.isArray(processedContent)) {
      return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{processedContent}</p>
    }
    // 否则使用原始文本
    return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
  }

  // 为 Markdown 渲染添加自定义组件处理主题引用
  const customComponents = {
    a: Link,
    code: CodeBlock,
    img: ImagePreview,
    // 添加处理主题引用的自定义组件
    p: ({ children, ...props }) => {
      if (typeof children === 'string') {
        // 在段落中查找主题引用
        const regex = /\[\[([^\]|]+)\]\|\[([^\]|]+)\]\]/g
        let lastIndex = 0
        const parts = []
        let match
        let foundReference = false

        while ((match = regex.exec(children)) !== null) {
          foundReference = true
          if (match.index > lastIndex) {
            parts.push(children.substring(lastIndex, match.index))
          }

          const [fullMatch, topicName, topicId] = match
          parts.push(
            <TopicReference
              key={`topic-${topicId}-${match.index}`}
              topicName={topicName}
              topicId={topicId}
              currentTopic={currentTopic}
            />
          )

          lastIndex = match.index + fullMatch.length
        }

        if (foundReference) {
          if (lastIndex < children.length) {
            parts.push(children.substring(lastIndex))
          }
          return <p {...props}>{parts}</p>
        }
      }

      // 默认返回普通段落
      return <p {...props}>{children}</p>
    }
  } as Partial<Components>

  return (
    <ReactMarkdown
      className="markdown"
      rehypePlugins={rehypePlugins}
      remarkPlugins={[remarkMath, remarkGfm]}
      components={customComponents}
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
