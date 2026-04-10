import { isSupportedReasoningEffortOpenAIModel, isSupportVerbosityModel } from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { Model } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import {
  isSupportServiceTierProvider,
  isSupportStreamOptionsProvider,
  isSupportVerbosityProvider
} from '@renderer/utils/provider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ReasoningSummarySetting from './ReasoningSummarySetting'
import ServiceTierSetting from './ServiceTierSetting'
import StreamOptionsSetting from './StreamOptionsSetting'
import VerbositySetting from './VerbositySetting'

interface Props {
  model: Model
  providerId: string
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const OpenAISettingsGroup: FC<Props> = ({ model, providerId, SettingGroup, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)

  const showSummarySetting =
    isSupportedReasoningEffortOpenAIModel(model) &&
    !model.id.includes('o1-pro') &&
    (provider.type === 'openai-response' || model.endpoint_type === 'openai-response' || provider.id === 'aihubmix')
  const showVerbositySetting = isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider)
  const isSupportServiceTier = isSupportServiceTierProvider(provider)
  const showServiceTierSetting = isSupportServiceTier && providerId !== SystemProviderIds.groq
  const showStreamOptionsSetting = isSupportStreamOptionsProvider(provider)

  if (!showSummarySetting && !showServiceTierSetting && !showVerbositySetting && !showStreamOptionsSetting) {
    return null
  }

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
        {showServiceTierSetting && (
          <>
            <ServiceTierSetting model={model} providerId={providerId} SettingRowTitleSmall={SettingRowTitleSmall} />
            {(showSummarySetting || showVerbositySetting || showStreamOptionsSetting) && <SettingDivider />}
          </>
        )}
        {showSummarySetting && (
          <>
            <ReasoningSummarySetting SettingRowTitleSmall={SettingRowTitleSmall} />
            {(showVerbositySetting || showStreamOptionsSetting) && <SettingDivider />}
          </>
        )}
        {showVerbositySetting && (
          <>
            <VerbositySetting model={model} SettingRowTitleSmall={SettingRowTitleSmall} />
            {showStreamOptionsSetting && <SettingDivider />}
          </>
        )}
        {showStreamOptionsSetting && <StreamOptionsSetting SettingRowTitleSmall={SettingRowTitleSmall} />}
      </SettingGroup>
      <SettingDivider />
    </CollapsibleSettingGroup>
  )
}

export default OpenAISettingsGroup
