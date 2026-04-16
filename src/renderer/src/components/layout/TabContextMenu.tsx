import { ChevronsLeft, Pin, PinOff, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

/** Above sidebar chrome (z-50) and app overlays; below ConfirmDialog (99998). */
const TAB_CONTEXT_MENU_Z_BACKDROP = 10049
const TAB_CONTEXT_MENU_Z_PANEL = 10050

interface TabContextMenuProps {
  x: number
  y: number
  isPinned: boolean
  onPin: () => void
  onClose: () => void
  onMoveToFirst: () => void
  onDismiss: () => void
}

export function TabContextMenu({ x, y, isPinned, onPin, onClose, onMoveToFirst, onDismiss }: TabContextMenuProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onDismiss])

  const ui = (
    <>
      {/* Captures all hits below the menu so sidebar / drag regions cannot steal pointer events */}
      <div
        role="presentation"
        className="fixed inset-0 [-webkit-app-region:no-drag]"
        style={{ zIndex: TAB_CONTEXT_MENU_Z_BACKDROP }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return
          e.preventDefault()
          onDismiss()
        }}
      />
      <div
        ref={ref}
        className="pointer-events-auto fixed min-w-[130px] rounded-[4px] border border-border bg-popover p-0.5 shadow-xl [-webkit-app-region:no-drag]"
        style={{ left: x, top: y, zIndex: TAB_CONTEXT_MENU_Z_PANEL }}
        onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-[5px] text-left text-[11px] text-popover-foreground transition-colors hover:bg-accent"
          onClick={() => {
            onMoveToFirst()
            onDismiss()
          }}>
          <ChevronsLeft size={11} />
          {t('tab.moveToFirst')}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-[5px] text-left text-[11px] text-popover-foreground transition-colors hover:bg-accent"
          onClick={() => {
            onPin()
            onDismiss()
          }}>
          {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
          {isPinned ? t('tab.unpin') : t('tab.pin')}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-[5px] text-left text-[11px] text-popover-foreground transition-colors hover:bg-accent"
          onClick={() => {
            onClose()
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
