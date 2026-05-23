import { Button } from '@cherrystudio/ui'
import type { Topic } from '@renderer/types'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BranchComposer from './BranchComposer'
import BranchMessageStream from './BranchMessageStream'
import { BRANCH_PANE_DEFAULT_WIDTH } from './constants'
import type { BranchAnchor } from './types'
import { useBranchPaneResize } from './useBranchPaneResize'

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
 * `<RowFlex>`, mirroring the existing right-Tabs motion.div pattern.
 *
 * State routing:
 *   - anchor && !branchTopic  → <BranchComposer/>
 *   - branchTopic             → <BranchMessageStream/>  (S4')
 *
 * Width (T-006D-2B Task 3): drag-controlled in-session state. The handle on
 * the LEFT edge resizes the pane; main chat column stays `flex:1` and
 * reflows. framer-motion still owns open/close (width 0 ↔ width); while
 * dragging, transition duration drops to 0 so the pane tracks the cursor
 * 1:1 without fighting the 0.3s easing. No persistence — width resets to
 * BRANCH_PANE_DEFAULT_WIDTH on app reload (out of scope here).
 *
 * Close behaviour: compose-state X clears anchor; conversation-state X is
 * disabled (DELETE-on-close ships later as path Y, see preflight cleanup).
 */
export default function BranchPane({ anchor, branchTopic, status, errorMessage, onCreate, onComposeCancel }: Props) {
  const { t } = useTranslation()
  const isVisible = anchor !== null || branchTopic !== null
  const isComposing = anchor !== null && branchTopic === null
  const isConversation = branchTopic !== null

  const [width, setWidth] = useState<number>(BRANCH_PANE_DEFAULT_WIDTH)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])

  const getCurrentWidth = useCallback(() => widthRef.current, [])
  const { isResizing, startResizing } = useBranchPaneResize(setWidth, getCurrentWidth)

  return (
    <motion.div
      key="branch-pane"
      initial={false}
      animate={{ width: isVisible ? width : 0, opacity: isVisible ? 1 : 0 }}
      // Drag must be 1:1 with the cursor; the open/close easing only fires
      // when motion drives the change itself (visibility toggles).
      transition={isResizing ? { duration: 0 } : { duration: 0.3, ease: 'easeInOut' }}
      style={{ overflow: 'hidden' }}
      // h-full is required to anchor the inner overflow-y-auto chain — see
      // Chat.tsx RowFlex note. Without it the motion.div has no bounded
      // height (animate only sets width), the inner `h-full` div resolves to
      // 0, and the scroll container collapses.
      className="relative h-full border-border border-l bg-accent/40">
      {/*
        Drag handle — left edge, full-height, 4px wide hit-target with a 1px
        visible border that highlights on hover. Only rendered when the pane
        is visible to avoid pointer interception during close animation.
        cursor-col-resize is set both on the element and (during drag) on
        document.body via the hook, so the cursor stays correct even when
        the pointer leaves the 4px strip mid-drag.
      */}
      {isVisible && (
        <div
          onMouseDown={startResizing}
          className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/40"
          data-testid="branch-pane-resize-handle"
          aria-orientation="vertical"
          aria-label={t('chat.message.anchor.panel.resize_handle')}
          role="separator"
        />
      )}
      {/*
        Inner container width tracks the state (NOT a fixed 420). During the
        open/close animation the outer motion.div clips overflow — content
        stays at full `width` while the visible window animates 0 → width.
      */}
      <div className="flex h-full shrink-0 flex-col" style={{ width }}>
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
            title={t('chat.message.anchor.panel.close')}
            aria-label={t('chat.message.anchor.panel.close')}
            data-testid="branch-pane-close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {isComposing && anchor && (
            <div className="overflow-y-auto">
              <BranchComposer
                anchor={anchor}
                status={status}
                errorMessage={errorMessage}
                onCreate={onCreate}
                onCancel={onComposeCancel}
              />
            </div>
          )}
          {isConversation && branchTopic && (
            <>
              {anchor && (
                <div className="shrink-0 border-border border-b bg-accent/40 px-4 py-3" data-testid="branch-pane-quote">
                  <div className="mb-1 text-muted-foreground text-xs">{t('chat.message.anchor.panel.from')}</div>
                  <blockquote className="border-accent border-l-2 bg-background/60 px-3 py-2 text-sm italic">
                    {anchor.selectedText}
                  </blockquote>
                </div>
              )}
              <BranchMessageStream topic={branchTopic} />
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
