import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { isEmpty } from 'lodash'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

import { useChatMarkdownComponents } from './useChatMarkdownComponents'

interface Props {
  block: MarkdownSource
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

const ChatMarkdown: FC<Props> = ({ block, postProcess, className, components }) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'

  const plugins = useMemo(() => withChatPlugins({ singleDollarMath: mathEnableSingleDollar }), [mathEnableSingleDollar])

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    let text = removeSvgEmptyLines(processLatexBrackets(block.content))
    if (postProcess) text = postProcess(text)
    return text
  }, [block.status, block.content, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const chatComponents = useChatMarkdownComponents({ blockId: block.id, hasStyleElement })
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )

  const footnoteLabel = t('common.footnotes')

  if (isStreaming) {
    return (
      <StreamingMarkdown id={block.id} plugins={plugins} components={mergedComponents} footnoteLabel={footnoteLabel}>
        {content}
      </StreamingMarkdown>
    )
  }
  return (
    <Markdown
      id={block.id}
      plugins={plugins}
      components={mergedComponents}
      className={className}
      footnoteLabel={footnoteLabel}>
      {content}
    </Markdown>
  )
}

export default ChatMarkdown
