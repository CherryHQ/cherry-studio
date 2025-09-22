import { Alert } from '@heroui/react'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { addIknowAction } from '@renderer/store/runtime'
import { useTranslation } from 'react-i18next'

import { Agents } from './Agents'
import { SectionName } from './SectionName'

const ALERT_KEY = 'enable_api_server_to_use_agent'

export const AgentSection = () => {
  const { t } = useTranslation()
  const { apiServer } = useSettings()
  const { iknow } = useRuntime()
  const dispatch = useAppDispatch()

  if (!apiServer.enabled) {
    if (iknow[ALERT_KEY]) return null
    return (
      <Alert
        color="warning"
        title={t('agent.warning.enable_server')}
        isClosable
        onClose={() => {
          dispatch(addIknowAction(ALERT_KEY))
        }}
      />
    )
  }

  return (
    <div className="agents-tab h-full w-full">
      <SectionName name={t('common.agent_other')} />
      <Agents />
    </div>
  )
}
