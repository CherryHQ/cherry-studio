import { Alert } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import type { ChatPreferenceSectionsFeatures } from '@renderer/pages/chat-settings/ChatPreferenceSections'
import ChatPreferenceSections from '@renderer/pages/chat-settings/ChatPreferenceSections'
import {
  SettingDivider,
  SettingGroup,
  SettingRowTitleSmall
} from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import type { Assistant } from '@renderer/types'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ProviderSettings } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import GroqSettingsGroup from './GroqSettingsGroup'
import OpenAISettingsGroup, { getOpenAISettingsVisibility } from './OpenAISettingsGroup'

interface Props {
  assistant: Assistant
}

const assistantPreferenceFeatures: ChatPreferenceSectionsFeatures = {
  showPrompt: true,
  showMessageOutline: true,
  showMultiModelStyle: true,
  showInputEstimatedTokens: true
}
const GROQ_PROVIDER_ID = 'groq'

const AssistantSettingsTab: FC<Props> = (props) => {
  const { t } = useTranslation()
  const { model: apiModel } = useModelById(props.assistant.modelId as UniqueModelId)
  const { defaultModel: apiDefaultModel } = useDefaultModel()
  const selectedApiModel = apiModel ?? (props.assistant.modelId ? undefined : apiDefaultModel)
  const model = useMemo(() => (selectedApiModel ? fromSharedModel(selectedApiModel) : undefined), [selectedApiModel])
  const { provider, updateProvider, isUpdating, updateError } = useProvider(model?.provider)

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

  const showOpenAiSettings = !!provider && !!model && getOpenAISettingsVisibility(model, provider).hasVisibleSettings

  return (
    <Scrollbar className="settings-tab flex flex-1 flex-col px-3 py-2 text-xs">
      {updateError && (
        <Alert
          type="error"
          showIcon
          message={t('common.error')}
          description={updateError.message}
          className="mx-1 mb-2 rounded-xs px-3 py-2 text-xs shadow-none"
        />
      )}
      {showOpenAiSettings && provider && model && (
        <>
          <OpenAISettingsGroup
            model={model}
            provider={provider}
            disabled={isUpdating}
            onProviderSettingsChange={updateProviderSettings}
            SettingGroup={SettingGroup}
            SettingRowTitleSmall={SettingRowTitleSmall}
          />
          <SettingDivider className="my-0" />
        </>
      )}
      {provider && provider.id === GROQ_PROVIDER_ID && (
        <>
          <GroqSettingsGroup
            provider={provider}
            disabled={isUpdating}
            onProviderSettingsChange={updateProviderSettings}
            SettingGroup={SettingGroup}
            SettingRowTitleSmall={SettingRowTitleSmall}
          />
          <SettingDivider className="my-0" />
        </>
      )}
      <ChatPreferenceSections features={assistantPreferenceFeatures} />
    </Scrollbar>
  )
}

export default AssistantSettingsTab
