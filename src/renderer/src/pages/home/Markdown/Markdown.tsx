import 'katex/dist/katex.min.css'

import { useSettings } from '@renderer/hooks/useSettings'
import { Message } from '@renderer/types'
import { escapeBrackets } from '@renderer/utils/formula'
import { isEmpty } from 'lodash'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { Components } from 'react-markdown'
import rehypeMathjax from 'rehype-mathjax'
// import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import CodeBlock from './CodeBlock'
import Link from './Link'

interface Props {
  message: Message
}

const rehypePlugins = [rehypeRaw, rehypeMathjax]
const remarkPlugins = [remarkMath, remarkGfm]

const components = {
  code: CodeBlock,
  a: Link
}

const Markdown: FC<Props> = ({ message }) => {
  const { t } = useTranslation()
  const { renderInputMessageAsMarkdown } = useSettings()

  const messageContent = useMemo(() => {
    const empty = isEmpty(message.content)
    const paused = message.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : message.content
    return escapeBrackets(content)
  }, [message.content, message.status, t])

  if (message.role === 'user' && !renderInputMessageAsMarkdown) {
    return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
  }

  return (
    <ReactMarkdown
      className="markdown"
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      components={components as Partial<Components>}
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
