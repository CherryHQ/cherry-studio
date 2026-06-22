import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CHAT_SHELL_PANE_WIDTH,
  CHAT_SHELL_TRANSITION,
  RESOURCE_LIST_PANE_MAX_WIDTH,
  RESOURCE_LIST_PANE_MIN_WIDTH
} from './paneLayout'
import { getVerticalSplitterProps } from './splitterA11y'
import { useResourceListPaneResize } from './useResourceListPaneResize'

export interface PageSidebarProps {
  children?: ReactNode
  open?: boolean
  width?: string | number
  className?: string
  style?: CSSProperties
  onPaneCollapse?: () => void
}

export function PageSidebar({ children, open, width, className, style, onPaneCollapse }: PageSidebarProps) {
  const { t } = useTranslation()
  const { isResizing, paneRef, paneWidth, startResizing, setPaneWidth } = useResourceListPaneResize({ onPaneCollapse })
  const resolvedWidth = width ?? paneWidth

  return (
    <AnimatePresence initial={false}>
      {open && children && (
        <motion.div
          ref={paneRef}
          key="page-sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: resolvedWidth || CHAT_SHELL_PANE_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={isResizing ? { duration: 0 } : CHAT_SHELL_TRANSITION}
          data-resource-list-pane
          data-resizing={isResizing || undefined}
          className={cn(
            'group/resource-list-pane relative shrink-0 overflow-hidden data-[resizing=true]:[&_.home-tabs-content]:transition-none data-[resizing=true]:[&_.home-tabs]:transition-none',
            className
          )}
          style={style}>
          <ErrorBoundary>{children}</ErrorBoundary>
          <div
            data-resource-list-pane-resize-handle
            onMouseDown={startResizing}
            {...getVerticalSplitterProps({
              width: paneWidth,
              min: RESOURCE_LIST_PANE_MIN_WIDTH,
              max: RESOURCE_LIST_PANE_MAX_WIDTH,
              label: t('common.resize_panel'),
              onResize: setPaneWidth
            })}
            className="group/resource-list-resize-handle absolute top-0 right-0 bottom-0 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <div className="absolute top-0 right-0 h-full w-0.5 bg-primary/20 opacity-0 transition-opacity group-hover/resource-list-resize-handle:opacity-100 group-data-[resizing=true]/resource-list-pane:bg-primary/35 group-data-[resizing=true]/resource-list-pane:opacity-100" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
