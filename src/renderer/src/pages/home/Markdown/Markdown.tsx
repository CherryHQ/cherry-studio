import 'katex/dist/katex.min.css'

import { Message } from '@renderer/types'
import { escapeBrackets } from '@renderer/utils/formula'
import { isEmpty } from 'lodash'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import CodeBlock from './CodeBlock'
import Link from './Link'

interface Props {
  message: Message
}

const rehypePlugins = [rehypeKatex]
const remarkPlugins = [remarkMath, remarkGfm]

const components = {
  code: CodeBlock,
  a: Link
}

const Markdown: FC<Props> = ({ message }) => {
  const { t } = useTranslation()

  const messageContent = useMemo(() => {
    const empty = isEmpty(message.content)
    const paused = message.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : message.content
    return escapeBrackets(content)
  }, [message.content, message.status, t])

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
