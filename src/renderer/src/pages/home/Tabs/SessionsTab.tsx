import { Alert, Spinner } from '@heroui/react'
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

  return (
    <AnimatePresence mode="wait">
      {!activeAgentId ? (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex h-full flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <motion.p
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="text-foreground-500 text-sm">
            {t('common.loading')}...
          </motion.p>
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
