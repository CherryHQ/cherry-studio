import { isSupportedReasoningEffortOpenAIModel, isSupportVerbosityModel } from '@renderer/config/models'
import { SettingGroup } from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import { SettingDivider } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { Model } from '@renderer/types'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider, ProviderSettings, ServiceTier } from '@shared/data/types/provider'
import type { OpenAIVerbosity } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ReasoningSummarySetting from './ReasoningSummarySetting'
import ServiceTierSetting from './ServiceTierSetting'
import StreamOptionsSetting from './StreamOptionsSetting'
import VerbositySetting from './VerbositySetting'

interface Props {
  model: Model
  provider: Provider
  disabled?: boolean
  onProviderSettingsChange: (providerSettings: Partial<ProviderSettings>) => void
}

const OPENAI_RESPONSES_ENDPOINTS = new Set<string>(['openai-response', ENDPOINT_TYPE.OPENAI_RESPONSES])
const OPENAI_PROTOCOL_ENDPOINTS = new Set<string>([
  'openai',
  'openai-response',
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES
])
const GROQ_PROVIDER_ID = 'groq'

function modelHasEndpoint(model: Model, endpoints: Set<string>): boolean {
  return (
    (model.endpoint_type ? endpoints.has(model.endpoint_type) : false) ||
    model.supported_endpoint_types?.some((endpointType) => endpoints.has(endpointType)) === true
  )
}

function providerHasEndpoint(provider: Provider, endpoints: Set<string>): boolean {
  return (
    (provider.defaultChatEndpoint ? endpoints.has(provider.defaultChatEndpoint) : false) ||
    Object.keys(provider.endpointConfigs ?? {}).some((endpointType) => endpoints.has(endpointType))
  )
}

export function getOpenAISettingsVisibility(model: Model, provider: Provider) {
  const isOpenAIProtocol =
    providerHasEndpoint(provider, OPENAI_PROTOCOL_ENDPOINTS) || modelHasEndpoint(model, OPENAI_PROTOCOL_ENDPOINTS)
  const isOpenAIResponsesProtocol =
    providerHasEndpoint(provider, OPENAI_RESPONSES_ENDPOINTS) || modelHasEndpoint(model, OPENAI_RESPONSES_ENDPOINTS)
  const showSummarySetting =
    isSupportedReasoningEffortOpenAIModel(model) &&
    !model.id.includes('o1-pro') &&
    (isOpenAIResponsesProtocol || provider.id === 'aihubmix')
  const showVerbositySetting = isSupportVerbosityModel(model) && provider.apiFeatures.verbosity
  const showServiceTierSetting = provider.apiFeatures.serviceTier && provider.id !== GROQ_PROVIDER_ID
  const showStreamOptionsSetting = provider.apiFeatures.streamOptions && isOpenAIProtocol

  return {
    showSummarySetting,
    showServiceTierSetting,
    showVerbositySetting,
    showStreamOptionsSetting,
    hasVisibleSettings: showSummarySetting || showServiceTierSetting || showVerbositySetting || showStreamOptionsSetting
  }
}

const OpenAISettingsGroup: FC<Props> = ({ model, provider, disabled, onProviderSettingsChange }) => {
  const { t } = useTranslation()
  const { showSummarySetting, showServiceTierSetting, showVerbositySetting, showStreamOptionsSetting } =
    getOpenAISettingsVisibility(model, provider)

  if (!showSummarySetting && !showServiceTierSetting && !showVerbositySetting && !showStreamOptionsSetting) {
    return null
  }

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
        {showServiceTierSetting && (
          <>
            <ServiceTierSetting
              model={model}
              serviceTierMode={provider.settings.serviceTier as ServiceTier}
              disabled={disabled}
              onServiceTierChange={(serviceTier) => onProviderSettingsChange({ serviceTier })}
            />
            {(showSummarySetting || showVerbositySetting || showStreamOptionsSetting) && <SettingDivider />}
          </>
        )}
        {showSummarySetting && (
          <>
            <ReasoningSummarySetting
              summaryText={provider.settings.summaryText}
              disabled={disabled}
              onSummaryTextChange={(summaryText) => onProviderSettingsChange({ summaryText })}
            />
            {(showVerbositySetting || showStreamOptionsSetting) && <SettingDivider />}
          </>
        )}
        {showVerbositySetting && (
          <>
            <VerbositySetting
              model={model}
              verbosity={provider.settings.verbosity as OpenAIVerbosity}
              disabled={disabled}
              onVerbosityChange={(verbosity) => onProviderSettingsChange({ verbosity })}
            />
            {showStreamOptionsSetting && <SettingDivider />}
          </>
        )}
        {showStreamOptionsSetting && (
          <StreamOptionsSetting
            includeUsage={provider.settings.streamOptions?.includeUsage}
            disabled={disabled}
            onIncludeUsageChange={(includeUsage) =>
              onProviderSettingsChange({ streamOptions: { ...provider.settings.streamOptions, includeUsage } })
            }
          />
        )}
      </SettingGroup>
    </CollapsibleSettingGroup>
  )
}

export default OpenAISettingsGroup
