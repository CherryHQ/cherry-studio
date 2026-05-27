/**
 * An in-page side drawer: the panel is positioned absolutely within its nearest
 * positioned parent, while the backdrop covers the viewport so sibling menus
 * and navigation chrome are dimmed and click-blocked.
 *
 * For a full-screen modal dialog that covers the whole viewport with a
 * backdrop, use the shadcn `Drawer` primitive from '@cherrystudio/ui' instead.
 */
import { Button } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { XIcon } from 'lucide-react'
import * as React from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'

import Scrollbar from '../scrollbar'

type PageSidePanelPlacement = 'left' | 'right'

interface PageSidePanelProps {
  open: boolean
  onClose: () => void
  children?: React.ReactNode
  title?: React.ReactNode
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
  title,
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
  const standardTitle = title ? <span className="font-semibold text-base text-foreground">{title}</span> : null
  const headerContent = header ?? standardTitle
  const hasHeader = !!headerContent || showCloseButton
  const headerId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const closedByPointerDownRef = useRef(false)

  const handleClose = useCallback(
    (event?: React.MouseEvent | React.PointerEvent | React.KeyboardEvent) => {
      event?.preventDefault()
      event?.stopPropagation()
      onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (open) {
      closedByPointerDownRef.current = false
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
            className={cn('fixed inset-0 z-[60] bg-black/50', backdropClassName)}
            onClick={handleClose}
          />
          <motion.aside
            ref={panelRef}
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headerContent ? headerId : undefined}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClose(e)
            }}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            data-slot="page-side-panel"
            className={cn(
              'absolute top-3 bottom-3 z-[70] flex w-100 flex-col overflow-hidden rounded-3xl bg-card text-card-foreground shadow-xl outline-none',
              side === 'right' ? 'right-3' : 'left-3',
              contentClassName
            )}>
            {hasHeader && (
              <div
                data-slot="page-side-panel-header"
                className={cn('flex shrink-0 items-center justify-between px-6 pt-6 pb-3', headerClassName)}>
                <div id={headerContent ? headerId : undefined} className="min-w-0 flex flex-1 items-center">
                  {headerContent}
                </div>
                {showCloseButton && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onPointerDown={(event) => {
                      closedByPointerDownRef.current = true
                      handleClose(event)
                    }}
                    onClick={(event) => {
                      if (closedByPointerDownRef.current) {
                        closedByPointerDownRef.current = false
                        event.preventDefault()
                        event.stopPropagation()
                        return
                      }
                      handleClose(event)
                    }}
                    aria-label={closeLabel}
                    data-slot="page-side-panel-close"
                    className={cn(
                      'ml-3 shrink-0 rounded-md opacity-70 shadow-none transition-opacity hover:bg-transparent hover:opacity-100',
                      closeButtonClassName
                    )}>
                    <XIcon size={16} />
                  </Button>
                )}
              </div>
            )}

            <Scrollbar data-slot="page-side-panel-body" className={cn('flex-1 space-y-4 px-6 py-4', bodyClassName)}>
              {children}
            </Scrollbar>

            {footer && (
              <div
                data-slot="page-side-panel-footer"
                className={cn('shrink-0 space-y-2.5 px-6 pt-3 pb-6', footerClassName)}>
                {footer}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

interface PageSidePanelSectionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}

function PageSidePanelSection({ title, actions, children, className, ...props }: PageSidePanelSectionProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground text-sm">{title}</span>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

interface PageSidePanelItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
}

function PageSidePanelItem({ title, description, action, children, className, ...props }: PageSidePanelItemProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground text-sm">{title}</span>
          {description && <span className="text-muted-foreground text-xs">{description}</span>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

export {
  PageSidePanel,
  PageSidePanelItem,
  type PageSidePanelItemProps,
  type PageSidePanelPlacement,
  type PageSidePanelProps,
  PageSidePanelSection,
  type PageSidePanelSectionProps
}
