import { Alert } from '@cherrystudio/ui'
import type { ChatPreferenceSectionsFeatures } from '@renderer/components/chat/settings/ChatPreferenceSections'
import ChatPreferenceSections from '@renderer/components/chat/settings/ChatPreferenceSections'
import Scrollbar from '@renderer/components/Scrollbar'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import type { Assistant } from '@renderer/types'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ProviderSettings } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import GroqSettingsGroup from './GroqSettingsGroup'
import OpenaiSettingsGroup, { getOpenaiSettingsVisibility } from './OpenaiSettingsGroup'

interface Props {
  assistant: Assistant
  scrollable?: boolean
}

const assistantPreferenceFeatures: ChatPreferenceSectionsFeatures = {
  showPrompt: true,
  showMessageOutline: true,
  showMultiModelStyle: true,
  showInputEstimatedTokens: true
}
const GROQ_PROVIDER_ID = 'groq'

const AssistantSettingsTab: FC<Props> = ({ assistant, scrollable = true }) => {
  const { t } = useTranslation()
  const { model: apiModel } = useModelById(assistant.modelId as UniqueModelId)
  const { defaultModel: apiDefaultModel } = useDefaultModel()
  const model = apiModel ?? (assistant.modelId ? undefined : apiDefaultModel)
  const { provider, updateProvider, isUpdating, updateError } = useProvider(model?.providerId)

  const updateProviderSettings = useCallback(
    async (providerSettings: Partial<ProviderSettings>) => {
      try {
        await updateProvider({ providerSettings })
      } catch (error) {
        window.toast.error(error instanceof Error ? error.message : t('common.error'))
      }
    },
    [t, updateProvider]
  )

  const showOpenAiSettings = !!provider && !!model && getOpenaiSettingsVisibility(model, provider).hasVisibleSettings

  const content = (
    <>
      {updateError && (
        <Alert
          type="error"
          showIcon
          message={t('common.error')}
          description={updateError.message}
          className="mx-1 mb-2 rounded-xs px-3 py-2 text-xs shadow-none"
        />
      )}
      <ChatPreferenceSections features={assistantPreferenceFeatures} />
      {provider && provider.id === GROQ_PROVIDER_ID && (
        <GroqSettingsGroup
          provider={provider}
          disabled={isUpdating}
          onProviderSettingsChange={updateProviderSettings}
        />
      )}
      {showOpenAiSettings && provider && model && (
        <OpenaiSettingsGroup
          model={model}
          provider={provider}
          disabled={isUpdating}
          onProviderSettingsChange={updateProviderSettings}
        />
      )}
    </>
  )

  if (!scrollable) {
    return <div className="settings-tab flex flex-1 flex-col">{content}</div>
  }

  return <Scrollbar className="settings-tab flex flex-1 flex-col px-3 py-2">{content}</Scrollbar>
}

export default AssistantSettingsTab
