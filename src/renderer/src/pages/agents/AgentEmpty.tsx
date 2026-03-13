import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useApiServer } from '@renderer/hooks/useApiServer'
import type { AgentEntity } from '@renderer/types'
import { Button } from 'antd'
import { Bot, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const AgentEmpty = () => {
  const { t } = useTranslation()
  const { apiServerRunning, startApiServer } = useApiServer()
  const { setActiveAgentId } = useActiveAgent()

  const handleAddAgent = useCallback(() => {
    !apiServerRunning && startApiServer()
    AgentModalPopup.show({
      afterSubmit: (agent: AgentEntity) => {
        setActiveAgentId(agent.id)
      }
    })
  }, [apiServerRunning, startApiServer, setActiveAgentId])

  return (
    <motion.div
      className="flex h-full w-full flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}>
      <Bot size={56} strokeWidth={1.2} className="text-(--color-text-secondary)" />
      <div className="flex flex-col items-center gap-2">
        <h3 className="m-0 font-medium text-(--color-text) text-base">{t('agent.empty.title')}</h3>
        <p className="m-0 max-w-xs text-center text-(--color-text-secondary) text-sm">{t('agent.empty.description')}</p>
      </div>
      <Button type="default" icon={<Plus size={16} />} onClick={handleAddAgent}>
        {t('agent.add.title')}
      </Button>
    </motion.div>
  )
}

export default AgentEmpty
