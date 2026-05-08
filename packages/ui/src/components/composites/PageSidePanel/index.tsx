/**
 * An in-page side drawer: positioned absolutely within its nearest positioned
 * parent (not viewport-fixed), so the surrounding page layout remains visible
 * and interactive alongside the panel.
 *
 * For a full-screen modal dialog that covers the whole viewport with a
 * backdrop, use the shadcn `Drawer` primitive from '@cherrystudio/ui' instead.
 */
import { Button } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { XIcon } from 'lucide-react'
import * as React from 'react'
import { useEffect, useRef } from 'react'

type PageSidePanelPlacement = 'left' | 'right'

interface PageSidePanelProps {
  open: boolean
  onClose: () => void
  children?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  side?: PageSidePanelPlacement
  showCloseButton?: boolean
  closeLabel?: string
  backdropClassName?: string
  contentClassName?: string
  headerClassName?: string
  bodyClassName?: string
  footerClassName?: string
  closeButtonClassName?: string
}

function PageSidePanel({
  open,
  onClose,
  children,
  header,
  footer,
  side = 'right',
  showCloseButton = true,
  closeLabel = 'Close',
  backdropClassName,
  contentClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  closeButtonClassName
}: PageSidePanelProps) {
  const hasHeader = !!header || showCloseButton
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null
      requestAnimationFrame(() => {
        panelRef.current?.focus()
      })
    } else {
      triggerRef.current?.focus()
      triggerRef.current = null
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            data-slot="page-side-panel-backdrop"
            className={cn('absolute inset-0 z-40 bg-black/20', backdropClassName)}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            key="panel"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            data-slot="page-side-panel"
            className={cn(
              'absolute top-2 bottom-2 z-50 flex w-100 flex-col overflow-hidden rounded-md border border-border/30 bg-card text-card-foreground shadow-2xl outline-none',
              side === 'right' ? 'right-2' : 'left-2',
              contentClassName
            )}>
            {hasHeader && (
              <div
                data-slot="page-side-panel-header"
                className={cn(
                  'flex h-11 shrink-0 items-center justify-between border-border/15 border-b px-4',
                  headerClassName
                )}>
                <div className="min-w-0 flex flex-1 items-center">{header}</div>
                {showCloseButton && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onClose}
                    aria-label={closeLabel}
                    data-slot="page-side-panel-close"
                    className={cn(
                      'ml-3 shrink-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground',
                      closeButtonClassName
                    )}>
                    <XIcon size={13} />
                  </Button>
                )}
              </div>
            )}

            <div
              data-slot="page-side-panel-body"
              className={cn('flex-1 space-y-4 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:hidden', bodyClassName)}>
              {children}
            </div>

            {footer && (
              <div
                data-slot="page-side-panel-footer"
                className={cn('shrink-0 space-y-2.5 border-border/15 border-t px-4 py-3', footerClassName)}>
                {footer}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

export { PageSidePanel, type PageSidePanelPlacement, type PageSidePanelProps }
