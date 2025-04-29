import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import type { Model } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

// HTML实体编码辅助函数
const encodeHTML = (str: string): string => {
  const entities: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }
  return str.replace(/[&<>"']/g, (match) => entities[match])
}

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  model?: Model
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const { renderInputMessageAsMarkdown } = useSettings()

  const formattedCitations = useSelector((state: RootState) =>
    selectFormattedCitationsByBlockId(state, citationBlockId)
  )

  const processedContent = useMemo(() => {
    let content = block.content
    // Update condition to use citationBlockId
    if (!block.citationReferences?.length || !citationBlockId || formattedCitations.length === 0) {
      return content
    }

    // FIXME：性能问题，需要优化
    // Replace all citation numbers in the content with formatted citations
    formattedCitations.forEach((citation) => {
      const citationNum = citation.number
      const supData = {
        id: citationNum,
        url: citation.url,
        title: citation.title || citation.hostname || '',
        content: citation.content?.substring(0, 200)
      }
      const citationJson = encodeHTML(JSON.stringify(supData))
      const citationTag = `[<sup data-citation='${citationJson}'>${citationNum}</sup>](${citation.url})`

      // Replace all occurrences of [citationNum] with the formatted citation
      const regex = new RegExp(`\\[${citationNum}\\]`, 'g')
      content = content.replace(regex, citationTag)
    })

    return content
  }, [block.content, block.citationReferences, citationBlockId, formattedCitations])

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{block.content}</p>
      ) : (
        <Markdown block={{ ...block, content: processedContent }} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
