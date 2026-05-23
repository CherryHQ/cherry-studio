import { Flex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useBranchAnchorHighlight } from '@renderer/context/BranchAnchorContext'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { clearSourceHighlight, paintSourceHighlight } from '@renderer/utils/branchAnchor/sourceHighlight'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import React, { useCallback, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
  /** Parent message id — surfaced as a DOM data-attribute so branch-anchor
   *  helpers can resolve a Selection back to (messageId, blockId). T-006B. */
  messageId: string
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [], messageId }) => {
  // Use the passed citationBlockId directly in the selector
  const [renderInputMessageAsMarkdown] = usePreference('chat.message.render_as_markdown')

  // T-006D-2B S6' / T-006E: when a branch panel is anchored to THIS block,
  // paint the exact selected passage (not the whole block — a whole reply is
  // one MAIN_TEXT block) via paintSourceHighlight, which wraps the resolved
  // Range's text nodes in `<span class="branch-anchor-highlight">`. Default
  // context value is null → no highlight when no branch is open.
  const { highlightedBlockId, selectionStart, selectionEnd } = useBranchAnchorHighlight()
  const isBranchAnchored = highlightedBlockId !== null && highlightedBlockId === block.id
  const blockScopeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = blockScopeRef.current
    if (!isBranchAnchored || !el || selectionStart >= selectionEnd) return
    // Paint now, then again next frame: the markdown subtree is normally
    // committed by the time this effect runs, but the rAF re-paint covers
    // any late DOM commit so the registered Range points at live nodes.
    // `block.content` as a dep re-runs the paint if the text changes.
    paintSourceHighlight(el, selectionStart, selectionEnd)
    const raf = requestAnimationFrame(() => paintSourceHighlight(el, selectionStart, selectionEnd))
    return () => {
      cancelAnimationFrame(raf)
      clearSourceHighlight()
    }
  }, [isBranchAnchored, selectionStart, selectionEnd, block.content])

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

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
      {/* Branch-anchor DOM scope: identifies this block + its message for
          Selection → (messageId, blockId, role) resolution. See T-006B. The
          role attribute lets SelectionContextMenu restrict branch actions to
          assistant text only.
          T-006D-2B S6' / T-006E: `blockScopeRef` is the root the precise-range
          highlight walks; the actual amber tint is painted by wrapping the
          selected character range in `<span class="branch-anchor-highlight">`
          via paintSourceHighlight (see sourceHighlight.ts), not as a className
          on this wrapper. The wrap is removed in the effect's cleanup via
          clearSourceHighlight, restoring the original DOM byte-for-byte. */}
      <div
        ref={blockScopeRef}
        data-message-id={messageId}
        data-block-id={block.id}
        data-message-role={role}
        data-branch-anchored={isBranchAnchored || undefined}>
        {role === 'user' && !renderInputMessageAsMarkdown ? (
          <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
            {block.content}
          </p>
        ) : (
          <Markdown block={block} postProcess={processContent} />
        )}
      </div>
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
