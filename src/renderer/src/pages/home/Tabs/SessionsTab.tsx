import { useRuntime } from '@renderer/hooks/useRuntime'
import { AnimatePresence,motion } from 'framer-motion'
import { FC, memo } from 'react'

import Sessions from './components/Sessions'

interface SessionsTabProps {}

const SessionsTab: FC<SessionsTabProps> = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat

  return (
    <AnimatePresence mode="wait">
      {!activeAgentId ? (
        <motion.div
          key="no-agent"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="flex h-full items-center justify-center text-foreground-500">
          No active agent.
        </motion.div>
      ) : (
        <motion.div
          key={activeAgentId}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}>
          <Sessions agentId={activeAgentId} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(SessionsTab)
