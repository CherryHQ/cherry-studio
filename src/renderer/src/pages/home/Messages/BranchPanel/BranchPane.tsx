import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BranchAccordionItem from './BranchAccordionItem'
import { BRANCH_PANE_DEFAULT_WIDTH } from './constants'
import type { Branch } from './types'
import { useBranchPaneResize } from './useBranchPaneResize'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** All currently-open branches (append-ordered = creation order). */
  branches: Branch[]
  /** Set of branch ids whose content is collapsed (header-only). */
  collapsedBranchIds: Set<string>
  /** Toggle collapse for a single branch id. */
  onToggleCollapsedBranchId: (branchId: string) => void
  /**
   * Branch id of the fork currently in flight. Only that branch's content
   * receives forkStatus/errorMessage; others always see 'idle'.
   */
  creatingBranchId: string | null
  forkStatus: ForkStatus
  forkErrorMessage?: string
  /** Compose-state submit. Host wires fork(branchId, followUp). */
  onCreate: (branchId: string, followUp: string) => void
  /** Conversation-state follow-up submit. Host routes to that branch's topic. */
  onSendFollowUp: (branchId: string, followUp: string) => void
  /** Close a single branch (header X or composer Cancel). Removes it + clears its spans. */
  onCloseBranch: (branchId: string) => void
}

/**
 * BranchPane — P1-S2c-accordion layout.
 *
 * ONE scroll region (`branch-pane-scroll`, `overflow-y-auto`). Branches render
 * in creation order, each as a <BranchAccordionItem> whose header and (when
 * expanded) content live in the SAME per-branch box. There is NO separate
 * master/tab region — the header is attached directly above its own content.
 * Plain document flow: NO `position: sticky`, NO `display: contents`; headers
 * scroll with their content.
 *
 * locate (auto-scroll): a newly-created branch and a just-expanded branch get
 * their item scrolled to the top of the region. Collapsing does not scroll.
 *
 * Cards sit OUTSIDE the BranchAnchorContext Provider (Chat.tsx wraps only the
 * main <Messages>), so branch-internal renders never re-paint source-passage
 * highlights — see the P1-S2b-1 isolation note.
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

  // locate: scroll a branch's item to the top of the scroll region. The item's
  // header always exists, so this works whether the branch is collapsed or
  // expanded. Optional chaining keeps it safe under jsdom (no layout engine).
  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const scrollItemToTop = useCallback((branchId: string) => {
    const el = scrollRegionRef.current?.querySelector(`[data-branch-item-id="${branchId}"]`)
    el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [])

  // locate on CREATE: a newly-appended branch (expanded by default — Chat never
  // adds it to collapsedBranchIds) scrolls into view.
  const prevBranchIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const prev = prevBranchIdsRef.current
    const added = branches.filter((b) => !prev.has(b.id))
    prevBranchIdsRef.current = new Set(branches.map((b) => b.id))
    const newest = added.at(-1)
    if (newest) scrollItemToTop(newest.id)
  }, [branches, scrollItemToTop])

  // locate on EXPAND: expanding (was collapsed) scrolls to the top; collapsing
  // (was expanded) does not scroll.
  const handleToggleCollapse = useCallback(
    (branchId: string) => {
      const wasCollapsed = collapsedBranchIds.has(branchId)
      onToggleCollapsedBranchId(branchId)
      if (wasCollapsed) scrollItemToTop(branchId)
    },
    [collapsedBranchIds, onToggleCollapsedBranchId, scrollItemToTop]
  )

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
      <div className="flex h-full flex-col" style={{ width }}>
        {/*
          THE single scroll region. Accordion items flow here in creation order;
          each item owns its own header + (when expanded) content. No separate
          master region; no sticky; no display:contents.
        */}
        <div
          ref={scrollRegionRef}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
          data-testid="branch-pane-scroll">
          {branches.map((branch, idx) => (
            <BranchAccordionItem
              key={branch.id}
              branch={branch}
              index={idx}
              collapsed={collapsedBranchIds.has(branch.id)}
              forkStatus={creatingBranchId === branch.id ? forkStatus : 'idle'}
              forkErrorMessage={creatingBranchId === branch.id ? forkErrorMessage : undefined}
              onToggleCollapse={() => handleToggleCollapse(branch.id)}
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
