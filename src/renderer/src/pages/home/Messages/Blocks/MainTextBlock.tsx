import { GroundingSupport } from '@google/genai'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model, WebSearchSource } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { cleanMarkdownContent, encodeHTML } from '@renderer/utils/formats'
import { Flex } from 'antd'
import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const { renderInputMessageAsMarkdown } = useSettings()

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

  const formattedCitations = useMemo(() => {
    return rawCitations.map((citation) => ({
      ...citation,
      content: citation.content ? cleanMarkdownContent(citation.content) : citation.content
    }))
  }, [rawCitations])

  const processedContent = useMemo(() => {
    let content = block.content
    // Update condition to use citationBlockId
    if (!block.citationReferences?.length || !citationBlockId || formattedCitations.length === 0) {
      return content
    }

    switch (block.citationReferences[0].citationBlockSource) {
      case WebSearchSource.OPENAI:
      case WebSearchSource.OPENAI_RESPONSE: {
        formattedCitations.forEach((citation) => {
          const citationNum = citation.number
          const supData = {
            id: citationNum,
            url: citation.url,
            title: citation.title || citation.hostname || '',
            content: citation.content?.substring(0, 200)
          }
          const citationJson = encodeHTML(JSON.stringify(supData))

          // Handle[<sup>N</sup>](url)
          const preFormattedRegex = new RegExp(`\\[<sup>${citationNum}</sup>\\]\\(.*?\\)`, 'g')

          const citationTag = `[<sup data-citation='${citationJson}'>${citationNum}</sup>](${citation.url})`

          content = content.replace(preFormattedRegex, citationTag)
        })
        break
      }
      case WebSearchSource.GEMINI: {
        // First pass: Add basic citation marks using metadata
        let processedContent = content
        const firstCitation = formattedCitations[0]
        if (firstCitation?.metadata) {
          firstCitation.metadata.forEach((support: GroundingSupport) => {
            const citationNums = support.groundingChunkIndices!

            if (support.segment) {
              const text = support.segment.text!
              // 生成引用标记
              const basicTag = citationNums
                .map((citationNum) => {
                  const citation = formattedCitations.find((c) => c.number === citationNum + 1)
                  return citation ? `[<sup>${citationNum + 1}</sup>](${citation.url})` : ''
                })
                .join('')

              // 在文本后面添加引用标记，而不是替换
              if (text && basicTag) {
                processedContent = processedContent.replace(text, `${text}${basicTag}`)
              }
            }
          })
          content = processedContent
        }
        // Second pass: Replace basic citations with full citation data
        formattedCitations.forEach((citation) => {
          const citationNum = citation.number
          const supData = {
            id: citationNum,
            url: citation.url,
            title: citation.title || citation.hostname || '',
            content: citation.content?.substring(0, 200)
          }
          const citationJson = encodeHTML(JSON.stringify(supData))

          // Replace basic citation with full citation including data
          const basicCitationRegex = new RegExp(`\\[<sup>${citationNum}</sup>\\]\\(${citation.url}\\)`, 'g')
          const fullCitationTag = `[<sup data-citation='${citationJson}'>${citationNum}</sup>](${citation.url})`
          content = content.replace(basicCitationRegex, fullCitationTag)
        })
        break
      }
      default: {
        // FIXME：性能问题，需要优化
        // Replace all citation numbers and pre-formatted links with formatted citations
        formattedCitations.forEach((citation) => {
          const citationNum = citation.number
          const supData = {
            id: citationNum,
            url: citation.url,
            title: citation.title || citation.hostname || '',
            content: citation.content?.substring(0, 200)
          }
          const isLink = citation.url.startsWith('http')
          const citationJson = encodeHTML(JSON.stringify(supData))

          // Handle both plain references [N] and pre-formatted links [<sup>N</sup>](url)
          const plainRefRegex = new RegExp(`\\[${citationNum}\\]`, 'g')

          const supTag = `<sup data-citation='${citationJson}'>${citationNum}</sup>`
          const citationTag = isLink ? `[${supTag}](${citation.url})` : supTag

          content = content.replace(plainRefRegex, citationTag)
        })
      }
    }

    return content
  }, [block.content, block.citationReferences, citationBlockId, formattedCitations])

  const ignoreToolUse = useMemo(() => {
    return processedContent.replace(toolUseRegex, '')
  }, [processedContent])

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
        <p className="markdown" style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>
          {block.content}
        </p>
      ) : (
        <Markdown block={{ ...block, content: ignoreToolUse }} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
