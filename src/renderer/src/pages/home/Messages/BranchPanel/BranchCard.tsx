import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import BranchComposer from './BranchComposer'
import BranchMessageStream from './BranchMessageStream'
import { BRANCH_HL_COLOR_VALUES, type BranchHlColorKey } from './constants'
import type { Branch, BranchAnchor } from './types'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** The branch this card represents. */
  branch: Branch
  /** 0-based; displayed as `index + 1` in the number badge (creation order). */
  index: number
  /** Whether the body is collapsed (tab header only). */
  collapsed: boolean
  /**
   * Fork-flow status routed in from Chat.tsx; only meaningful when this card
   * is the currently-creating branch (Chat tracks `creatingBranchId`). Other
   * cards always receive `'idle'`.
   */
  forkStatus: ForkStatus
  forkErrorMessage?: string
  /** Toggle chevron clicked. */
  onToggleCollapse: () => void
  /** X clicked OR Cancel inside the composer. Same handler — both close this branch. */
  onClose: () => void
  /** Compose-state submit. Host wires fork({branchId, followUp}). */
  onCreate: (followUp: string) => void
}

/**
 * BranchCard — one stack entry in the multi-branch panel (P1-S2b-1).
 *
 * Header strip painted with the branch's palette color (same `data-hl` key
 * that drives the source-passage highlight, so card ↔ highlight share a
 * color). Header layout: `[#N badge] [snippet truncated] [chevron] [X]`.
 *
 * Body:
 *   - compose state (branch.topic === null) → <BranchComposer> (existing path)
 *   - conversation state (branch.topic !== null) → quote + <BranchMessageStream>
 *
 * Deferred to S2b-2: protruding/beveled folder-tab visuals, hover↔highlight
 * linkage, auto-scroll-into-view on new branch creation, follow-up composer
 * in conversation state (the last one touches streaming → out of S2b-1 scope).
 */
export default function BranchCard({
  branch,
  index,
  collapsed,
  forkStatus,
  forkErrorMessage,
  onToggleCollapse,
  onClose,
  onCreate
}: Props) {
  const { t } = useTranslation()

  const isComposing = branch.topic === null
  const colorKey: BranchHlColorKey = branch.color
  const colorValue = BRANCH_HL_COLOR_VALUES[colorKey]

  // Compose-state needs a BranchAnchor-shaped object (BranchComposer's
  // existing input contract). Build it on the fly from branch.source.
  const composerAnchor: BranchAnchor = {
    messageId: branch.source.messageId,
    blockId: branch.source.blockId,
    selectedText: branch.source.selectedText,
    selectionStart: branch.source.offsets.start,
    selectionEnd: branch.source.offsets.end
  }

  return (
    <div
      className="flex flex-col rounded-md border border-border bg-background"
      data-testid={`branch-card-${branch.id}`}>
      {/*
        Header strip — colored tab. Tinted with the branch's palette color
        via inline style so it renders correctly before paintSourceHighlight
        has injected its CSS variables (BranchCard can mount before any paint
        happens on first render).
      */}
      <div
        className="flex items-center gap-2 rounded-t-md border-border border-b px-3 py-2"
        style={{ backgroundColor: colorValue }}
        data-testid="branch-card-tab"
        data-branch-id={branch.id}
        data-hl={colorKey}>
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background/70 font-semibold text-xs"
          data-testid="branch-card-badge">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground text-sm" data-testid="branch-card-snippet">
          {branch.source.selectedText}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          aria-label={t('chat.message.anchor.panel.card.toggle_collapse')}
          aria-expanded={!collapsed}
          data-testid="branch-card-chevron">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t('chat.message.anchor.panel.close')}
          data-testid="branch-card-close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!collapsed && (
        <div className="flex min-h-0 flex-col" data-testid="branch-card-body">
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
              <div className="shrink-0 border-border border-b bg-accent/40 px-4 py-3" data-testid="branch-card-quote">
                <div className="mb-1 text-muted-foreground text-xs">{t('chat.message.anchor.panel.from')}</div>
                <blockquote className="border-accent border-l-2 bg-background/60 px-3 py-2 text-sm italic">
                  {branch.source.selectedText}
                </blockquote>
              </div>
              {/* branch.topic is non-null here by the isComposing check. */}
              {branch.topic && <BranchMessageStream topic={branch.topic} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}
