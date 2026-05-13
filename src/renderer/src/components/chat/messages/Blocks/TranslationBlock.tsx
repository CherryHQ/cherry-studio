import { MessageBlockStatus } from '@renderer/types/newMessage'
import React, { useMemo } from 'react'

import type { MarkdownSource } from '../markdown/Markdown'
import MessageTranslate from './MessageTranslate'

interface Props {
  /** Stable ID for heading prefix */
  id: string
  /** Translated content (markdown) */
  content: string
  /** Whether this block is currently streaming */
  isStreaming: boolean
}

const TranslationBlock: React.FC<Props> = ({ id, content, isStreaming }) => {
  const markdownSource = useMemo<MarkdownSource>(
    () => ({
      id,
      content,
      status: isStreaming ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS
    }),
    [id, content, isStreaming]
  )

  return <MessageTranslate block={markdownSource} />
}

export default React.memo(TranslationBlock)
