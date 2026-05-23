import { Flex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { BRANCH_ANCHOR_DEFAULT, useBranchAnchorHighlight } from '@renderer/context/BranchAnchorContext'
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

// T-006D-2B S6' D-013: temporary full-path trace instrumentation. Remove once
// the highlight is confirmed working in `pnpm dev`.
const logger = loggerService.withContext('MainTextBlock')

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

  // T-006D-2B S6': when a branch panel is anchored to THIS block, paint the
  // exact selected passage (not the whole block — a whole reply is one
  // MAIN_TEXT block) via the CSS Custom Highlight API. Default context value
  // is null → no highlight when no branch is open.
  const branchAnchorHighlight = useBranchAnchorHighlight()
  // [S6 trace] D-013 — raw context value received by THIS MainTextBlock at the
  // useContext read (logged every render, not just when the effect fires).
  //
  // `insideProvider` is the decisive discriminator: `use(BranchAnchorContext)`
  // returns BRANCH_ANCHOR_DEFAULT *by reference* iff no Provider is above the
  // reader. So `insideProvider: false` ⇒ this MainTextBlock is rendered by the
  // branch panel's BranchMessageStream (a sibling of Chat.tsx's Provider) —
  // reading null is correct and expected for it. `insideProvider: true` ⇒ it
  // resolved to Chat.tsx's Provider and `rawContext` IS exactly the value
  // Chat.tsx supplied; if that is still null while Stage 0 wrote a real
  // blockId, only THEN is there a genuine plumbing bug.
  logger.debug('[S6 trace] MainTextBlock context read', {
    blockId: block.id,
    insideProvider: branchAnchorHighlight !== BRANCH_ANCHOR_DEFAULT,
    rawContext: branchAnchorHighlight
  })
  const { highlightedBlockId, selectionStart, selectionEnd } = branchAnchorHighlight
  const isBranchAnchored = highlightedBlockId !== null && highlightedBlockId === block.id
  const blockScopeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = blockScopeRef.current
    // [S6 trace] Stage 1 — did this block's effect fire, did it match, and if
    // it bailed out, WHY. `earlyReturn` decomposes the original guard into a
    // named reason — same control flow, just observable. `empty-offsets` means
    // the context value arrived fine but capture produced selectionStart >=
    // selectionEnd, so the paint never runs (a silent no-op until now).
    const earlyReturn = !isBranchAnchored
      ? 'not-anchored'
      : !el
        ? 'no-element'
        : selectionStart >= selectionEnd
          ? 'empty-offsets'
          : null
    logger.debug('[S6 trace] effect fired', {
      blockId: block.id,
      insideProvider: branchAnchorHighlight !== BRANCH_ANCHOR_DEFAULT,
      highlightedBlockId,
      matched: isBranchAnchored,
      selectionStart,
      selectionEnd,
      earlyReturn
    })
    if (earlyReturn !== null || el === null) return
    // [S6 trace] Stage 2 — block element resolved?
    logger.debug('[S6 trace] block element', {
      found: !!el,
      blockTextLength: el.textContent?.length ?? 0
    })
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
    // [S6 trace] deps deliberately unchanged — the trace logs above read
    // block.id / highlightedBlockId for diagnostics only; not changing the
    // effect's trigger condition this round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          T-006D-2B S6': `blockScopeRef` is the root the precise-range
          highlight walks; the actual amber tint is painted on the exact
          selected character range via the CSS Custom Highlight API, not as a
          className on this wrapper. */}
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
