import { Button } from '@cherrystudio/ui'
import type { Topic } from '@renderer/types'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import BranchComposer from './BranchComposer'
import BranchMessageStream from './BranchMessageStream'
import type { BranchAnchor } from './types'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** When non-null, the panel is visible. */
  anchor: BranchAnchor | null
  /** Once Create has succeeded, the branch topic is stored here. */
  branchTopic: Topic | null
  /** Status from useBranchFork (idle | creating | error). */
  status: ForkStatus
  /** Translated error from useBranchFork. */
  errorMessage?: string
  /** Triggers useBranchFork.fork(anchor, followUp). */
  onCreate: (followUp: string) => void
  /**
   * Compose-state close (Cancel or header X while no branchTopic yet) —
   * clears anchor in the host. Safe to call.
   */
  onComposeCancel: () => void
}

/**
 * BranchPane — T-006D-2B side-by-side container.
 *
 * Mounts as a layout sibling of the chat <Main> column via Chat.tsx's
 * `<RowFlex>`, mirroring the existing right-Tabs motion.div pattern
 * (Chat.tsx:204-224). Width fixed to 420px, slides in/collapses on
 * `anchor != null || branchTopic != null`.
 *
 * State routing:
 *   - anchor && !branchTopic  → <BranchComposer/>
 *   - branchTopic             → placeholder (S4' replaces with BranchMessageStream)
 *
 * Close behaviour (S3' only):
 *   - Compose state: X-button → onComposeCancel (clears anchor only).
 *   - Conversation state: close is disabled; S5' wires DELETE /topics +
 *     removeTopic + clearing both states under "Path Y". Until then, users
 *     who want to dismiss the panel must refresh; this is documented in the
 *     tooltip + console-visible.
 */
export default function BranchPane({ anchor, branchTopic, status, errorMessage, onCreate, onComposeCancel }: Props) {
  const { t } = useTranslation()
  const isVisible = anchor !== null || branchTopic !== null
  const isComposing = anchor !== null && branchTopic === null
  const isConversation = branchTopic !== null

  return (
    <motion.div
      key="branch-pane"
      initial={false}
      animate={{ width: isVisible ? 420 : 0, opacity: isVisible ? 1 : 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      style={{ overflow: 'hidden' }}
      className="border-border border-l bg-accent/40">
      {/*
        We render the inner content unconditionally so the slide-out animation
        doesn't snap the children to empty mid-collapse. shrink-0 + fixed inner
        width keeps the layout stable while motion.div animates the outer wrapper.
      */}
      <div className="flex h-full w-[420px] shrink-0 flex-col">
        <header
          className="flex items-center justify-between border-border border-b px-4 py-3"
          data-testid="branch-pane-header">
          <div className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
            {isComposing && anchor
              ? t('chat.message.anchor.panel.from_message', { id: anchor.messageId.slice(0, 8) })
              : isConversation && branchTopic
                ? t('chat.message.anchor.panel.conversation_header', { id: branchTopic.id.slice(0, 8) })
                : ''}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onComposeCancel}
            disabled={!isComposing}
            title={
              isConversation
                ? t('chat.message.anchor.panel.close_disabled_tooltip')
                : t('chat.message.anchor.panel.close')
            }
            aria-label={t('chat.message.anchor.panel.close')}
            data-testid="branch-pane-close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isComposing && anchor && (
            <BranchComposer
              anchor={anchor}
              status={status}
              errorMessage={errorMessage}
              onCreate={onCreate}
              onCancel={onComposeCancel}
            />
          )}
          {isConversation && branchTopic && (
            <div className="flex h-full min-h-0 flex-col">
              {/*
                Sticky quote box at the top of the conversation state — keeps
                the visual link between the source selection and the branch
                reply visible while the user reads. anchor is intentionally
                NOT cleared on Create in Chat.tsx, so it's available here.
              */}
              {anchor && (
                <div
                  className="sticky top-0 z-10 border-border border-b bg-accent/40 px-4 py-3"
                  data-testid="branch-pane-quote">
                  <div className="mb-1 text-muted-foreground text-xs">{t('chat.message.anchor.panel.from')}</div>
                  <blockquote className="border-accent border-l-2 bg-background/60 px-3 py-2 text-sm italic">
                    {anchor.selectedText}
                  </blockquote>
                </div>
              )}
              <BranchMessageStream topic={branchTopic} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
