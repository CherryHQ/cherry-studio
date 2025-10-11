import { Alert, cn } from '@heroui/react'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { AnimatePresence, motion } from 'framer-motion'
import { type FC, memo } from 'react'
import { useTranslation } from 'react-i18next'

import Sessions from './components/Sessions'

interface SessionsTabProps {}

const SessionsTab: FC<SessionsTabProps> = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { t } = useTranslation()
  const { apiServer } = useSettings()
  const { topicPosition, navbarPosition } = useSettings()

  if (!apiServer.enabled) {
    return (
      <div>
        <Alert color="warning" title={t('agent.warning.enable_server')} />
      </div>
    )
  }

  if (!activeAgentId) {
    return (
      <div>
        <Alert color="warning" title={'Select an agent'} />
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 'var(--assistants-width)', opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        className={cn(
          'overflow-hidden',
          topicPosition === 'right' && navbarPosition === 'top' ? 'rounded-l-2xl border-t border-b border-l' : undefined
        )}>
        <Sessions agentId={activeAgentId} />
      </motion.div>
    </AnimatePresence>
  )
}

export default memo(SessionsTab)
