/**
 * Floating toolbar, right-aligned to the selection and flipped above it when there
 * is no room below.
 *
 * Groups, left to right: annotation tools · undo/redo · OCR affordance · save/cancel/ok.
 */

import { Button, NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Check, Download, MoveUpRight, Pencil, Redo2, Square, Type, Undo2, X } from 'lucide-react'
import type { ComponentType, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { memo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { PROPERTY_PANEL_HEIGHT, Z_INDEX } from '../constants'
import type { AnnotationTool, SelectionRect } from '../types'

interface ToolbarProps {
  selection: SelectionRect
  logicalHeight: number
  activeTool: AnnotationTool | null
  canUndo: boolean
  canRedo: boolean
  onToolChange: (tool: AnnotationTool) => void
  onUndo: () => void
  onRedo: () => void
  onOk: () => void
  onSave: () => void
  onCancel: () => void
  /**
   * OCR affordance, rendered with its own divider when present.
   *
   * A slot rather than a status prop: the toolbar has no business knowing the OCR
   * state machine, and the caller already decides whether the icon shows at all.
   */
  ocrSlot?: ReactNode
  /** Reports geometry for the property panel and the dimension label. */
  onLayout?: (info: { top: number; height: number; left: number; width: number; below: boolean }) => void
}

/** Space between the selection edge and the toolbar, in CSS px. */
const GAP = 8
/** Toolbar height estimate in CSS px: border + padding + a 32 px icon button + padding + border. */
const TOOLBAR_HEIGHT = 38

/**
 * Lucide ships no mosaic glyph, so this is its `Grid3x3` box with five of the nine cells
 * filled. The 3→21 frame and 9/15 dividers cut exact 6×6 cells; the corner cells are drawn
 * as arcs, not squares, or they would poke past the rx=2 rounding. Grid3x3's divider lines
 * are dropped on purpose — at stroke-width 2 they fuse with the fills and the icon reads as
 * a solid block with four holes, while the empty cells already mark out the grid.
 */
function MosaicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path
        fill="currentColor"
        stroke="none"
        d="M3 5a2 2 0 0 1 2-2h4v6H3Zm12-2h4a2 2 0 0 1 2 2v4h-6Zm-6 6h6v6H9Zm-6 6h6v6H5a2 2 0 0 1-2-2Zm12 0h6v4a2 2 0 0 1-2 2h-4Z"
      />
    </svg>
  )
}

const TOOL_ICONS: { tool: AnnotationTool; icon: ComponentType<{ className?: string }>; labelKey: string }[] = [
  { tool: 'rect', icon: Square, labelKey: 'screenshot.tool.rectangle' },
  { tool: 'arrow', icon: MoveUpRight, labelKey: 'screenshot.tool.arrow' },
  { tool: 'brush', icon: Pencil, labelKey: 'screenshot.tool.brush' },
  { tool: 'text', icon: Type, labelKey: 'screenshot.tool.text' },
  { tool: 'mosaic', icon: MosaicIcon, labelKey: 'screenshot.tool.mosaic' }
]

export const Toolbar = memo(function Toolbar({
  selection,
  logicalHeight,
  activeTool,
  canUndo,
  canRedo,
  onToolChange,
  onUndo,
  onRedo,
  onOk,
  onSave,
  onCancel,
  ocrSlot,
  onLayout
}: ToolbarProps) {
  const { t } = useTranslation()
  const prevLayoutRef = useRef<string>('')
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Reserve room for the property panel too, or opening a tool near the bottom edge
  // would push the panel off-screen. 4 = the panel's own gap to the toolbar.
  const totalHeight = TOOLBAR_HEIGHT + 4 + PROPERTY_PANEL_HEIGHT
  const belowY = selection.y + selection.height + GAP
  const aboveY = selection.y - TOOLBAR_HEIGHT - GAP
  const fitsBelow = belowY + totalHeight <= logicalHeight
  const isBelow = fitsBelow || aboveY < 0
  const top = isBelow ? belowY : Math.max(0, aboveY)

  const right = selection.x + selection.width

  // Guarded because onLayout is a parent setState — unconditional during render is an infinite loop.
  // Deferred because the panel aligns to the toolbar's MEASURED left edge, known only after commit.
  const layoutKey = `${top}:${TOOLBAR_HEIGHT}:${right}:${isBelow}`
  if (onLayout && layoutKey !== prevLayoutRef.current) {
    prevLayoutRef.current = layoutKey
    queueMicrotask(() => {
      const rect = toolbarRef.current?.getBoundingClientRect()
      onLayout({
        top,
        height: rect?.height ?? TOOLBAR_HEIGHT,
        left: rect?.left ?? selection.x,
        width: rect?.width ?? 0,
        below: isBelow
      })
    })
  }

  return (
    <div
      ref={toolbarRef}
      className="absolute flex items-center gap-0.5 rounded-lg border border-border bg-popover/85 p-0.5 shadow-md backdrop-blur-xs"
      style={{
        zIndex: Z_INDEX.TOOLBAR,
        top,
        left: right,
        transform: 'translateX(-100%)'
      }}
      // Without this, clicking any button also starts a new background selection on
      // the capture canvas underneath and wipes the selection being acted on.
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}>
      {TOOL_ICONS.map(({ tool, icon: Icon, labelKey }) => (
        <ToolbarButton
          key={tool}
          icon={<Icon className="size-5" />}
          label={t(labelKey)}
          active={activeTool === tool}
          onClick={() => onToolChange(tool)}
        />
      ))}

      <ToolbarDivider />

      <ToolbarButton
        icon={<Undo2 className="size-5" />}
        label={t('screenshot.action.undo')}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolbarButton
        icon={<Redo2 className="size-5" />}
        label={t('screenshot.action.redo')}
        disabled={!canRedo}
        onClick={onRedo}
      />

      {ocrSlot && (
        <>
          <ToolbarDivider />
          {ocrSlot}
        </>
      )}

      <ToolbarDivider />

      <ToolbarButton icon={<Download className="size-5" />} label={t('screenshot.action.save')} onClick={onSave} />
      <ToolbarButton
        icon={<X className="size-5" />}
        label={t('screenshot.action.cancel')}
        className="text-destructive hover:text-destructive"
        onClick={onCancel}
      />
      <ToolbarButton
        icon={<Check className="size-5" />}
        label={t('screenshot.action.confirm')}
        className="text-success hover:text-success"
        onClick={onOk}
      />
    </div>
  )
})

function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px bg-muted-foreground/20" />
}

function ToolbarButton({
  icon,
  label,
  className,
  active,
  disabled,
  onClick
}: {
  icon: ReactNode
  label: string
  className?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <NormalTooltip content={label} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        // The tooltip is not a name: lucide icons are aria-hidden, so without this the
        // button reaches assistive tech unnamed. `active` is undefined for the plain
        // actions, which is what keeps aria-pressed off anything that does not toggle.
        aria-label={label}
        aria-pressed={active}
        // size-8 overrides the shared icon size: TOOLBAR_HEIGHT and PROPERTY_PANEL_HEIGHT
        // are both derived from a 32 px control, and the flip maths uses those constants.
        className={cn('size-8', active ? 'bg-accent text-primary' : (className ?? 'text-popover-foreground'))}
        disabled={disabled}
        onClick={onClick}>
        {icon}
      </Button>
    </NormalTooltip>
  )
}
