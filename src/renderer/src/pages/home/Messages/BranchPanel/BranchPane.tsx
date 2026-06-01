import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BranchCard from './BranchCard'
import { BRANCH_PANE_DEFAULT_WIDTH } from './constants'
import type { Branch } from './types'
import { useBranchPaneResize } from './useBranchPaneResize'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** All currently-open branches (P1-S2b-1: previously a single anchor + topic). */
  branches: Branch[]
  /** Set of branch ids whose card body is currently collapsed (header-only). */
  collapsedBranchIds: Set<string>
  /** Toggle collapse for a single branch id. Setter is host-owned. */
  onToggleCollapsedBranchId: (branchId: string) => void
  /**
   * Branch id of the fork currently in flight (`useBranchFork` is a single
   * global hook; Chat.tsx tracks which branch initiated the in-flight fork).
   * Only that card receives forkStatus/errorMessage; others always see 'idle'.
   */
  creatingBranchId: string | null
  forkStatus: ForkStatus
  forkErrorMessage?: string
  /** Compose-state submit. Host wires fork(branchId, followUp). */
  onCreate: (branchId: string, followUp: string) => void
  /** Conversation-state follow-up submit (P1-S2b-2). Host routes to that branch's topic. */
  onSendFollowUp: (branchId: string, followUp: string) => void
  /** Close a single branch (X button or composer Cancel). Removes its spans + drops from branches[]. */
  onCloseBranch: (branchId: string) => void
}

/**
 * BranchPane — P1-S2b-1 multi-branch container.
 *
 * Renders a vertical stack of N <BranchCard> components (one per branch).
 * Pane is visible iff branches.length > 0; width animates 0 ↔ width via
 * framer-motion, identical to the prior single-branch behaviour generalised
 * to N. Cards inside this pane intentionally sit OUTSIDE the
 * BranchAnchorContext Provider (which wraps only the main <Messages>) so
 * branch-internal MessageGroup renders never re-paint source-passage
 * highlights — see the integration risk note in P1-S2b-1 README.
 *
 * Width state (drag-controlled) stays here; identical mechanics to S2a.
 */
export default function BranchPane({
  branches,
  collapsedBranchIds,
  onToggleCollapsedBranchId,
  creatingBranchId,
  forkStatus,
  forkErrorMessage,
  onCreate,
  onSendFollowUp,
  onCloseBranch
}: Props) {
  const { t } = useTranslation()
  const isVisible = branches.length > 0

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
      transition={isResizing ? { duration: 0 } : { duration: 0.3, ease: 'easeInOut' }}
      style={{ overflow: 'hidden' }}
      className="relative h-full border-border border-l bg-accent/40">
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
      <div className="flex h-full shrink-0 flex-col" style={{ width }}>
        {/*
          N cards rendered in creation order (branches[] is append-ordered).
          The outer scroll container lets the stack overflow when many cards
          are expanded; each individual BranchMessageStream owns its own
          inner scroll for the conversation body.
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2" data-testid="branch-pane-stack">
          {branches.map((branch, idx) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              index={idx}
              collapsed={collapsedBranchIds.has(branch.id)}
              forkStatus={creatingBranchId === branch.id ? forkStatus : 'idle'}
              forkErrorMessage={creatingBranchId === branch.id ? forkErrorMessage : undefined}
              onToggleCollapse={() => onToggleCollapsedBranchId(branch.id)}
              onClose={() => onCloseBranch(branch.id)}
              onCreate={(followUp) => onCreate(branch.id, followUp)}
              onSendFollowUp={(followUp) => onSendFollowUp(branch.id, followUp)}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
