import { ChevronsLeft, Pin, PinOff, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onDismiss])

  return (
    <div
      ref={ref}
      className="fixed z-[300] min-w-[130px] rounded-md border border-border bg-popover p-0.5 shadow-xl"
      style={{ left: x, top: y }}>
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
  )
}
