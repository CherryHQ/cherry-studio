import { Alert, cn } from '@heroui/react'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { AnimatePresence, motion } from 'framer-motion'
import { FC, memo } from 'react'
import { useTranslation } from 'react-i18next'

import Sessions from './components/Sessions'

interface SessionsTabProps {}

const SessionsTab: FC<SessionsTabProps> = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { t } = useTranslation()
  const { apiServer } = useSettings()

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
      <motion.div className={cn('overflow-hidden', 'h-full')}>
        <Sessions agentId={activeAgentId} />
      </motion.div>
    </AnimatePresence>
  )
}

export default memo(SessionsTab)
