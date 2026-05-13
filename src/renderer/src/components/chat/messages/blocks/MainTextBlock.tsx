import { Flex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import type { Citation, Model, WebSearchSource } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { createUniqueModelId } from '@shared/data/types/model'
import React, { useCallback } from 'react'

import type { MarkdownSource } from '../markdown/Markdown'
import Markdown from '../markdown/Markdown'
import CitationsList from './CitationsList'

interface Props {
  id: string
  content: string
  isStreaming: boolean
  citations?: Citation[]
  citationReferences?: { citationBlockId?: string; citationBlockSource?: WebSearchSource }[]
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({
  id,
  content,
  isStreaming,
  citations = [],
  citationReferences,
  role,
  mentions = []
}) => {
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')

  const block: MarkdownSource = { id, content, status: isStreaming ? 'streaming' : 'success' }

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      if (!citationReferences?.length || citations.length === 0) {
        return rawText
      }

      // 确定最适合的 source
      const sourceType = determineCitationSource(citationReferences)

      return withCitationTags(rawText, citations, sourceType)
    },
    [citationReferences, citations]
  )

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {mentions.map((m) => (
            <span key={createUniqueModelId(m.provider, m.id)} className="text-(--color-link)">
              {'@' + m.name}
            </span>
          ))}
        </Flex>
      )}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {content}
        </p>
      ) : (
        <Markdown block={block} postProcess={processContent} />
      )}
      {/* Source list rendered under each text part with citations. V1's
          `CitationBlock` did the same thing once per message; parts data stores
          citation refs per text part (`providerMetadata.cherry.references`)
          so the list ends up scoped to the text segment that produced it. */}
      {citations.length > 0 && <CitationsList citations={citations} />}
    </>
  )
}

export default React.memo(MainTextBlock)
