import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
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
  /** Chevron OR snippet click → expand/collapse this branch's detail. */
  onToggleCollapse: () => void
  /** X → close this branch (removes it + clears its highlight). */
  onClose: () => void
}

/**
 * BranchTab — one row in the MASTER region (P1-S2c master/detail rewrite).
 *
 * The master region is a SIBLING of the scrolling detail region (not its
 * ancestor), so every tab stays visible while the detail body scrolls — no
 * `position: sticky`, no `display: contents`. Badge is tinted with the
 * branch's palette color (same `data-hl` key as the source highlight) so the
 * tab visually maps to its highlighted passage.
 */
export default function BranchTab({ branch, index, collapsed, onToggleCollapse, onClose }: Props) {
  const { t } = useTranslation()
  const colorKey: BranchHlColorKey = branch.color
  const colorValue = BRANCH_HL_COLOR_VALUES[colorKey]

  return (
    <div
      className="flex items-center gap-2 border-border border-b px-2 py-1.5"
      data-testid={`branch-tab-${branch.id}`}
      data-branch-id={branch.id}
      data-hl={colorKey}>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-semibold text-foreground text-xs"
        style={{ backgroundColor: colorValue }}
        data-testid="branch-tab-badge">
        {index + 1}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-foreground text-sm"
        onClick={onToggleCollapse}
        title={branch.source.selectedText}
        data-testid="branch-tab-snippet">
        {branch.source.selectedText}
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCollapse}
        aria-label={t('chat.message.anchor.panel.card.toggle_collapse')}
        aria-expanded={!collapsed}
        data-testid="branch-tab-chevron">
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label={t('chat.message.anchor.panel.close')}
        data-testid="branch-tab-close">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
