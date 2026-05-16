import { Flex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ARTIFACT_EXT } from '@renderer/config/constant'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import React, { useCallback } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

const filePathRe = new RegExp(
  `(?<![\\w])(?:(?:/?|[a-zA-Z]:[/\\\\]|(?:\\./)?))(?:[^\\s/\\\\]+(?:[/\\\\][^\\s/\\\\]+)+)${ARTIFACT_EXT}(?![\\w/.])`,
  'gi'
)

// Protects fenced code blocks, inline code, and markdown links from file path wrapping.
// Uses the same placeholder convention as processLatexBrackets in utils/markdown.
const PROTECT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|\[(?:[^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\([^)]*?\))/g
const RESTORE_RE = /__CHERRY_STUDIO_PROTECTED_(\d+)__/g

// Wraps un-backticked file paths in backticks so they render as <code>
// and get handled by CodeBlock's ClickableFilePath.
function wrapFilePathsInBackticks(text: string): string {
  const protectedSpans: string[] = []
  const protected_ = text.replace(PROTECT_RE, (match) => {
    const index = protectedSpans.length
    protectedSpans.push(match)
    return `__CHERRY_STUDIO_PROTECTED_${index}__`
  })
  const result = protected_.replace(filePathRe, '`$&`')
  return result.replace(RESTORE_RE, (_, indexStr) => {
    const index = parseInt(indexStr, 10)
    return index >= 0 && index < protectedSpans.length ? protectedSpans[index] : indexStr
  })
}

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      let text = rawText

      // Process citations
      if (block.citationReferences?.length && citationBlockId && rawCitations.length > 0) {
        const sourceType = determineCitationSource(block.citationReferences)
        text = withCitationTags(text, rawCitations, sourceType)
      }

      // Wrap file paths in backticks so they become clickable via CodeBlock
      text = wrapFilePathsInBackticks(text)

      return text
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
