import { ChevronsLeft, Columns2, Pin, PinOff, Rows2, SquareSplitHorizontal, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { usePanes } from '../../hooks/usePanes'

/** Above sidebar chrome (z-50) and app overlays; below ConfirmDialog (99998). */
const Z_BACKDROP = 10049
const Z_PANEL = 10050

interface PaneTabContextMenuProps {
  paneId: string
  tabId: string
  x: number
  y: number
  isPinned: boolean
  onMoveToFirst: () => void
  onDismiss: () => void
}

/**
 * Right-click menu for a tab inside a leaf pane. Successor to the legacy
 * TabContextMenu — addressed by (paneId, tabId) instead of a flat id.
 */
export function PaneTabContextMenu({
  paneId,
  tabId,
  x,
  y,
  isPinned,
  onMoveToFirst,
  onDismiss
}: PaneTabContextMenuProps) {
  const { t } = useTranslation()
  const { pinTab, unpinTab, splitPane, unsplitPane, closeTab, panes } = usePanes()
  const ref = useRef<HTMLDivElement>(null)

  // A pane can be unsplit only when it lives inside a split parent.
  const canUnsplit = panes.root.type === 'split'

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onDismiss])

  const item =
    'flex w-full items-center gap-1.5 rounded-sm px-2 py-[5px] text-left text-[11px] text-popover-foreground transition-colors hover:bg-accent'

  const ui = (
    <>
      <div
        role="presentation"
        className="fixed inset-0 [-webkit-app-region:no-drag]"
        style={{ zIndex: Z_BACKDROP }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return
          e.preventDefault()
          onDismiss()
        }}
      />
      <div
        ref={ref}
        className="pointer-events-auto fixed min-w-[140px] rounded-[4px] border border-border bg-popover p-0.5 shadow-xl [-webkit-app-region:no-drag]"
        style={{ left: x, top: y, zIndex: Z_PANEL }}
        onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={item}
          onClick={() => {
            onMoveToFirst()
            onDismiss()
          }}>
          <ChevronsLeft size={11} />
          {t('tab.moveToFirst')}
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            if (isPinned) unpinTab(paneId, tabId)
            else pinTab(paneId, tabId)
            onDismiss()
          }}>
          {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
          {isPinned ? t('tab.unpin') : t('tab.pin')}
        </button>
        <div className="my-0.5 h-px bg-border" />
        <button
          type="button"
          className={item}
          onClick={() => {
            splitPane(paneId, 'horizontal')
            onDismiss()
          }}>
          <Columns2 size={11} />
          {t('tab.splitRight')}
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            splitPane(paneId, 'vertical')
            onDismiss()
          }}>
          <Rows2 size={11} />
          {t('tab.splitDown')}
        </button>
        {canUnsplit && (
          <button
            type="button"
            className={item}
            onClick={() => {
              unsplitPane(paneId)
              onDismiss()
            }}>
            <SquareSplitHorizontal size={11} />
            {t('tab.unsplit')}
          </button>
        )}
        <div className="my-0.5 h-px bg-border" />
        <button
          type="button"
          className={item}
          onClick={() => {
            closeTab(paneId, tabId)
            onDismiss()
          }}>
          <X size={11} />
          {t('tab.close')}
        </button>
      </div>
    </>
  )

  return typeof document !== 'undefined' ? createPortal(ui, document.body) : ui
}
