import { Flex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { formatCitationsFromBlock, selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import type { MainTextMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import React, { useCallback, useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'
import { useV2BlockMap } from './V2Contexts'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')
  const v2Blocks = useV2BlockMap()

  // V2: resolve citation block from V2BlockContext directly
  // V1: read from Redux via selector
  const reduxCitations = useSelector((state: RootState) =>
    v2Blocks ? [] : selectFormattedCitationsByBlockId(state, citationBlockId)
  )
  const rawCitations = useMemo(() => {
    if (!v2Blocks || !citationBlockId) return reduxCitations
    const citationBlock = v2Blocks[citationBlockId] as MessageBlock | undefined
    if (citationBlock?.type === MessageBlockType.CITATION) {
      return formatCitationsFromBlock(citationBlock)
    }
    return []
  }, [v2Blocks, citationBlockId, reduxCitations])

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      if (!block.citationReferences?.length || !citationBlockId || rawCitations.length === 0) {
        return rawText
      }

      // 确定最适合的 source
      const sourceType = determineCitationSource(block.citationReferences)

      return withCitationTags(rawText, rawCitations, sourceType)
    },
    [block.citationReferences, citationBlockId, rawCitations]
  )

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {block.content}
        </p>
      ) : (
        <Markdown block={block} postProcess={processContent} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
