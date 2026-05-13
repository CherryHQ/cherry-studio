import Scrollbar from '@renderer/components/Scrollbar'
import { isOpenAIModel, isSupportedReasoningEffortOpenAIModel, isSupportVerbosityModel } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProvider'
import type { ChatPreferenceSectionsFeatures } from '@renderer/pages/chat-settings/ChatPreferenceSections'
import ChatPreferenceSections from '@renderer/pages/chat-settings/ChatPreferenceSections'
import {
  SettingDivider,
  SettingGroup,
  SettingRowTitleSmall
} from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import type { Assistant } from '@renderer/types'
import { isGroqSystemProvider, SystemProviderIds } from '@renderer/types'
import {
  isOpenAICompatibleProvider,
  isSupportServiceTierProvider,
  isSupportStreamOptionsProvider,
  isSupportVerbosityProvider
} from '@renderer/utils/provider'
import type { FC } from 'react'
import { useMemo } from 'react'

import GroqSettingsGroup from './GroqSettingsGroup'
import OpenAISettingsGroup from './OpenAISettingsGroup'

interface Props {
  assistant: Assistant
}

const assistantPreferenceFeatures: ChatPreferenceSectionsFeatures = {
  showPrompt: true,
  showMessageOutline: true,
  showMultiModelStyle: true,
  showInputEstimatedTokens: true
}

const AssistantSettingsTab: FC<Props> = (props) => {
  const { model: apiModel } = useAssistant(props.assistant.id)
  const { defaultModel: apiDefaultModel } = useDefaultModel()
  const v1Model = useMemo(() => (apiModel ? fromSharedModel(apiModel) : undefined), [apiModel])
  const v1DefaultModel = useMemo(
    () => (apiDefaultModel ? fromSharedModel(apiDefaultModel) : undefined),
    [apiDefaultModel]
  )
  const { provider } = useProvider(v1Model?.provider ?? '')

  const model = v1Model || v1DefaultModel

  const showOpenAiSettings =
    !!provider &&
    !!model &&
    ((isSupportStreamOptionsProvider(provider) && (isOpenAICompatibleProvider(provider) || isOpenAIModel(model))) ||
      (isSupportedReasoningEffortOpenAIModel(model) &&
        !model.id.includes('o1-pro') &&
        (provider.type === 'openai-response' ||
          model.endpoint_type === 'openai-response' ||
          provider.id === 'aihubmix')) ||
      (isSupportServiceTierProvider(provider) && provider.id !== SystemProviderIds.groq) ||
      (isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider)))

  return (
    <Scrollbar className="settings-tab flex flex-1 flex-col px-3 py-2 text-xs">
      {showOpenAiSettings && provider && model && (
        <>
          <OpenAISettingsGroup
            model={model}
            providerId={provider.id}
            SettingGroup={SettingGroup}
            SettingRowTitleSmall={SettingRowTitleSmall}
          />
          <SettingDivider className="my-0" />
        </>
      )}
      {provider && isGroqSystemProvider(provider) && (
        <>
          <GroqSettingsGroup SettingGroup={SettingGroup} SettingRowTitleSmall={SettingRowTitleSmall} />
          <SettingDivider className="my-0" />
        </>
      )}
      <ChatPreferenceSections features={assistantPreferenceFeatures} />
    </Scrollbar>
  )
}

export default AssistantSettingsTab
