import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { BRANCH_HL_COLOR_VALUES, type BranchHlColorKey } from './constants'
import type { Branch } from './types'

interface Props {
  /** The branch this tab represents. */
  branch: Branch
  /** 0-based; shown as `index + 1` in the badge (creation order). */
  index: number
  /** Whether this branch's detail is collapsed (tab-only in the body). */
  collapsed: boolean
  /** P1-S2d: this branch's reply is currently streaming → show a loading spinner. */
  loading?: boolean
  /** Chevron / snippet / bar click → expand/collapse this branch's detail. */
  onToggleCollapse: () => void
  /** X → close this branch (removes it + clears its highlight). */
  onClose: () => void
  /** P1-S2d: pointer entered/left the bar → emphasise the matching source highlight. */
  onHoverEnter?: () => void
  onHoverLeave?: () => void
}

/**
 * BranchTab — one branch's header row in the single-region accordion
 * (P1-S2c). P1-S2d turns it into a FLAT, color-coded bar (background = the
 * branch's highlight palette color, the same `data-hl` key as its source
 * passage) that is itself the hover/click/collapse target. Strictly flat — no
 * raised/angled folder-tab shape. The inner controls (snippet, chevron, X) stop
 * propagation so they keep firing exactly one action each, while empty bar area
 * toggles collapse.
 */
export default function BranchTab({
  branch,
  index,
  collapsed,
  loading,
  onToggleCollapse,
  onClose,
  onHoverEnter,
  onHoverLeave
}: Props) {
  const { t } = useTranslation()
  const colorKey: BranchHlColorKey = branch.color
  const colorValue = BRANCH_HL_COLOR_VALUES[colorKey]

  // Inner controls must not also trigger the whole-bar onClick.
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    fn()
  }

  return (
    <div
      className="flex cursor-pointer select-none items-center gap-2 border-border border-b px-2 py-1.5"
      style={{ backgroundColor: colorValue }}
      data-testid={`branch-tab-${branch.id}`}
      data-branch-id={branch.id}
      data-hl={colorKey}
      onClick={onToggleCollapse}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-semibold text-foreground text-xs ring-1 ring-black/5"
        style={{ backgroundColor: colorValue }}
        data-testid="branch-tab-badge">
        {index + 1}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-foreground text-sm"
        onClick={stop(onToggleCollapse)}
        title={branch.source.selectedText}
        data-testid="branch-tab-snippet">
        {branch.source.selectedText}
      </button>
      {loading && (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
          aria-label={t('chat.message.anchor.panel.card.streaming')}
          data-testid="branch-tab-loading"
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={stop(onToggleCollapse)}
        aria-label={t('chat.message.anchor.panel.card.toggle_collapse')}
        aria-expanded={!collapsed}
        data-testid="branch-tab-chevron">
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={stop(onClose)}
        aria-label={t('chat.message.anchor.panel.close')}
        data-testid="branch-tab-close">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
