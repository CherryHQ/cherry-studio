import type { MarkdownSource } from '@cherrystudio/ui'
import React, { useMemo } from 'react'

import MessageTranslate from './MessageTranslate'

interface Props {
  /** Stable ID for heading prefix */
  id: string
  /** Translated content (markdown) */
  content: string
  /** Whether this block is currently streaming */
  isStreaming: boolean
  /** Remove this translation */
  onDelete?: () => void
}

const TranslationBlock: React.FC<Props> = ({ id, content, isStreaming, onDelete }) => {
  const markdownSource = useMemo<MarkdownSource>(
    () => ({
      id,
      content,
      status: isStreaming ? 'streaming' : 'success'
    }),
    [id, content, isStreaming]
  )

  return <MessageTranslate block={markdownSource} onDelete={onDelete} />
}

export default React.memo(TranslationBlock)
