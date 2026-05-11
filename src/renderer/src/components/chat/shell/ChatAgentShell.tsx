import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

export interface ChatAgentShellProps {
  topBar?: ReactNode
  sidebar?: ReactNode
  showSidebar: boolean
  main: ReactNode
  contentId?: string
  rootId?: string
  rootClassName?: string
}

export function ChatAgentShell({
  topBar,
  sidebar,
  showSidebar,
  main,
  contentId,
  rootId,
  rootClassName
}: ChatAgentShellProps) {
  return (
    <div id={rootId} className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      {topBar}
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AnimatePresence initial={false}>
          {showSidebar && sidebar && (
            <ErrorBoundary>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}>
                {sidebar}
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>{main}</ErrorBoundary>
      </div>
    </div>
  )
}
