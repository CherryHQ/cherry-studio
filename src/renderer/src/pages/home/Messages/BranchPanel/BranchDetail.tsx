import { Button } from '@cherrystudio/ui'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import BranchComposer from './BranchComposer'
import BranchFollowUpComposer from './BranchFollowUpComposer'
import BranchMessageStream from './BranchMessageStream'
import type { Branch, BranchAnchor } from './types'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** The branch this detail block represents. */
  branch: Branch
  /** Fork status — only non-idle for the branch currently being created. */
  forkStatus: ForkStatus
  forkErrorMessage?: string
  /** Compose-state submit (Enter or Create button) → fork this branch. */
  onCreate: (followUp: string) => void
  /** Conversation-state submit → send a follow-up to this branch's topic. */
  onSendFollowUp: (followUp: string) => void
  /** Compose-state Cancel → close this branch (same as the tab's X). */
  onClose: () => void
  /** P1-S3: toggle this branch's disposition pending ↔ kept (Keep button). */
  onToggleKeep: () => void
}

/**
 * BranchDetail — the expanded CONTENT of one accordion item (P1-S2c-accordion).
 *
 * Content ONLY — NO outer box / border / shrink-0 of its own. Its containing
 * box is the per-branch accordion item (`BranchAccordionItem`), which owns the
 * `shrink-0` non-shrinkable box (the S2c overlap fix) so the single scroll
 * region scrolls instead of flex-compressing it. NO `display: contents`, NO
 * `position: sticky`, NO internal overflow (the region is the sole scroller —
 * clipping here would hide conversation).
 *
 * Two modes:
 *   - compose (branch.topic === null) → <BranchComposer> (its own quote + form)
 *   - conversation (branch.topic !== null) → quote + stream + follow-up composer
 */
export default function BranchDetail({
  branch,
  forkStatus,
  forkErrorMessage,
  onCreate,
  onSendFollowUp,
  onClose,
  onToggleKeep
}: Props) {
  const { t } = useTranslation()
  const isComposing = branch.topic === null
  const kept = branch.disposition === 'kept'

  const composerAnchor: BranchAnchor = {
    messageId: branch.source.messageId,
    blockId: branch.source.blockId,
    selectedText: branch.source.selectedText,
    selectionStart: branch.source.offsets.start,
    selectionEnd: branch.source.offsets.end
  }

  return (
    <div
      className="flex flex-col border-border border-t"
      data-testid={`branch-detail-${branch.id}`}
      data-branch-id={branch.id}>
      {/*
        P1-S3: Keep toggle. Default disposition is `pending` → closing silently
        deletes the fork topic. Clicking Keep flips to `kept` → closing leaves
        the topic in the DB. `aria-pressed` + filled icon show the kept state.
      */}
      <div className="flex shrink-0 justify-end border-border border-b px-2 py-1">
        <Button
          variant={kept ? 'default' : 'ghost'}
          size="sm"
          onClick={onToggleKeep}
          aria-pressed={kept}
          data-testid="branch-keep-toggle"
          data-kept={kept}>
          {kept ? <BookmarkCheck className="mr-1 h-4 w-4" /> : <Bookmark className="mr-1 h-4 w-4" />}
          {kept ? t('chat.message.anchor.panel.kept') : t('chat.message.anchor.panel.keep')}
        </Button>
      </div>
      {isComposing ? (
        <BranchComposer
          anchor={composerAnchor}
          status={forkStatus}
          errorMessage={forkErrorMessage}
          onCreate={onCreate}
          onCancel={onClose}
        />
      ) : (
        <>
          <div className="shrink-0 border-border border-b bg-accent/40 px-4 py-3" data-testid="branch-detail-quote">
            <div className="mb-1 text-muted-foreground text-xs">{t('chat.message.anchor.panel.from')}</div>
            <blockquote className="border-accent border-l-2 bg-background/60 px-3 py-2 text-sm italic">
              {branch.source.selectedText}
            </blockquote>
          </div>
          {/* branch.topic is non-null here by the isComposing check. */}
          {branch.topic && <BranchMessageStream topic={branch.topic} />}
          <BranchFollowUpComposer onSend={onSendFollowUp} />
        </>
      )}
    </div>
  )
}
