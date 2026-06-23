import { scrollElementIntoView } from '@renderer/utils/dom'
import { motion } from 'motion/react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BranchAccordionItem from './BranchAccordionItem'
import { BRANCH_PANE_DEFAULT_WIDTH } from './constants'
import type { Branch } from './types'
import { useBranchPaneResize } from './useBranchPaneResize'
import { useLoadingByTopic } from './useBranchTopicLoading'
import { useHighlightCardLink } from './useHighlightCardLink'

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
  /** P1-S3: toggle a single branch's disposition pending ↔ kept (Keep button). */
  onToggleKeepBranch: (branchId: string) => void
  /**
   * P1-S2d: shared DOM ancestor of both the main-thread highlight spans and
   * these cards (the Chat `#chat` container). Used for highlight→card event
   * delegation. Optional so unit tests can render the pane in isolation.
   */
  containerRef?: RefObject<HTMLElement | null>
  /** P1-S2d: ensure a branch is expanded (used when clicking its source highlight). */
  onExpandBranch?: (branchId: string) => void
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
  onCloseBranch,
  onToggleKeepBranch,
  containerRef,
  onExpandBranch
}: Props) {
  const { t } = useTranslation()
  const isVisible = branches.length > 0

  // P1-S2d item 3: reliable per-card streaming flag (loadingByTopic — NOT
  // message.status). Keyed by each branch's own fork topic id, so the spinner
  // lights up only on the card whose reply is in flight.
  const loadingByTopic = useLoadingByTopic()

  const [width, setWidth] = useState<number>(BRANCH_PANE_DEFAULT_WIDTH)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])

  const getCurrentWidth = useCallback(() => widthRef.current, [])
  const { isResizing, startResizing } = useBranchPaneResize(setWidth, getCurrentWidth)

  // locate: scroll a branch's item into view WITHIN this pane's single scroll
  // region. The item's header always exists, so this works whether the branch
  // is collapsed or expanded. `scrollElementIntoView` scrolls the passed
  // container (not the page), so locating a card never drags the main thread's
  // scrollbar — the single scroll region is the S2c invariant. Optional
  // chaining keeps it safe under jsdom (no layout engine).
  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const scrollItemIntoView = useCallback((branchId: string) => {
    const el = scrollRegionRef.current?.querySelector<HTMLElement>(`[data-branch-item-id="${branchId}"]`)
    // Feature-detect scrollIntoView so jsdom (no layout engine) is a safe no-op,
    // mirroring the prior `el?.scrollIntoView?.()` guard.
    if (el && typeof el.scrollIntoView === 'function') scrollElementIntoView(el, scrollRegionRef.current)
  }, [])

  // locate on CREATE: a newly-appended branch (expanded by default — Chat never
  // adds it to collapsedBranchIds) scrolls into view.
  const prevBranchIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const prev = prevBranchIdsRef.current
    const added = branches.filter((b) => !prev.has(b.id))
    prevBranchIdsRef.current = new Set(branches.map((b) => b.id))
    const newest = added.at(-1)
    if (newest) scrollItemIntoView(newest.id)
  }, [branches, scrollItemIntoView])

  // locate on EXPAND: expanding (was collapsed) scrolls into view; collapsing
  // (was expanded) does not scroll.
  const handleToggleCollapse = useCallback(
    (branchId: string) => {
      const wasCollapsed = collapsedBranchIds.has(branchId)
      onToggleCollapsedBranchId(branchId)
      if (wasCollapsed) scrollItemIntoView(branchId)
    },
    [collapsedBranchIds, onToggleCollapsedBranchId, scrollItemIntoView]
  )

  // P1-S2d item 1: clicking a source highlight expands its card AND scrolls it
  // into view, even if it was already expanded.
  const handleActivateBranch = useCallback(
    (branchId: string) => {
      onExpandBranch?.(branchId)
      scrollItemIntoView(branchId)
    },
    [onExpandBranch, scrollItemIntoView]
  )

  // P1-S2d item 1: bidirectional card ↔ highlight emphasis. `hoveredBranchId`
  // is local pane state, so hover churn re-renders only the panel — never the
  // <Messages> subtree (the isolation invariant); the span side is imperative.
  const { hoveredBranchId, handleCardMouseEnter, handleCardMouseLeave } = useHighlightCardLink({
    containerRef,
    onActivateBranch: handleActivateBranch
  })

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
              loading={!!(branch.topic && loadingByTopic[branch.topic.id])}
              emphasized={hoveredBranchId === branch.id}
              onToggleCollapse={() => handleToggleCollapse(branch.id)}
              onClose={() => onCloseBranch(branch.id)}
              onCreate={(followUp) => onCreate(branch.id, followUp)}
              onSendFollowUp={(followUp) => onSendFollowUp(branch.id, followUp)}
              onToggleKeep={() => onToggleKeepBranch(branch.id)}
              onHoverEnter={() => handleCardMouseEnter(branch.id)}
              onHoverLeave={handleCardMouseLeave}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
