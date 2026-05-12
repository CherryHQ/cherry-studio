import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'

import { CHAT_SHELL_PANE_WIDTH, CHAT_SHELL_TRANSITION } from './types'

export interface RightPaneHostProps {
  children?: ReactNode
  open?: boolean
  width?: string | number
  className?: string
  style?: CSSProperties
}

export function RightPaneHost({ children, open, width = CHAT_SHELL_PANE_WIDTH, className, style }: RightPaneHostProps) {
  return (
    <AnimatePresence initial={false}>
      {open && children && (
        <motion.div
          key="right-pane"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={CHAT_SHELL_TRANSITION}
          className={cn('shrink-0 overflow-hidden', className)}
          style={style}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
