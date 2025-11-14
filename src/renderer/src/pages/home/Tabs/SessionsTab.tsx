import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { cn } from '@renderer/utils'
import { Alert } from 'antd'
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

  if (!apiServer.enabled) {
    return <Alert type="warning" message={t('agent.warning.enable_server')} style={{ margin: 10 }} />
  }

  if (!activeAgentId) {
    return <Alert type="warning" message={'Select an agent'} style={{ margin: 10 }} />
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
