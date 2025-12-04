import { HelpTooltip } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import {
  getModelSupportedVerbosity,
  isSupportedReasoningEffortOpenAIModel,
  isSupportFlexServiceTierModel,
  isSupportVerbosityModel
} from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setOpenAISummaryText, setOpenAIVerbosity } from '@renderer/store/settings'
import type { Model, OpenAIServiceTier, ServiceTier } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import type { OpenAISummaryText, OpenAIVerbosity } from '@renderer/types/aiCoreTypes'
import { isSupportServiceTierProvider, isSupportVerbosityProvider } from '@renderer/utils/provider'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

type VerbosityOption = {
  value: NonNullable<OpenAIVerbosity> | 'undefined'
  label: string
}

type SummaryTextOption = {
  value: NonNullable<OpenAISummaryText> | 'undefined'
  label: string
}

type OpenAIServiceTierOption = { value: NonNullable<OpenAIServiceTier> | 'null' | 'undefined'; label: string }

interface Props {
  model: Model
  providerId: string
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const OpenAISettingsGroup: FC<Props> = ({ model, providerId, SettingGroup, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const verbosity = useSelector((state: RootState) => state.settings.openAI.verbosity)
  const summaryText = useSelector((state: RootState) => state.settings.openAI.summaryText)
  const serviceTierMode = provider.serviceTier
  const dispatch = useAppDispatch()

  const showSummarySetting =
    isSupportedReasoningEffortOpenAIModel(model) &&
    !model.id.includes('o1-pro') &&
    (provider.type === 'openai-response' || model.endpoint_type === 'openai-response' || provider.id === 'aihubmix')
  const showVerbositySetting = isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider)
  const isSupportFlexServiceTier = isSupportFlexServiceTierModel(model)
  const isSupportServiceTier = isSupportServiceTierProvider(provider)
  const showServiceTierSetting = isSupportServiceTier && providerId !== SystemProviderIds.groq

  const setSummaryText = useCallback(
    (value: OpenAISummaryText) => {
      dispatch(setOpenAISummaryText(value))
    },
    [dispatch]
  )

  const setServiceTierMode = useCallback(
    (value: ServiceTier) => {
      updateProvider({ serviceTier: value })
    },
    [updateProvider]
  )

  const setVerbosity = useCallback(
    (value: OpenAIVerbosity) => {
      dispatch(setOpenAIVerbosity(value))
    },
    [dispatch]
  )

  const summaryTextOptions = [
    {
      value: 'undefined',
      label: t('common.ignore')
    },
    {
      value: 'auto',
      label: t('settings.openai.summary_text_mode.auto')
    },
    {
      value: 'detailed',
      label: t('settings.openai.summary_text_mode.detailed')
    },
    {
      value: 'concise',
      label: t('settings.openai.summary_text_mode.concise')
    }
  ] as const satisfies SummaryTextOption[]

  const verbosityOptions = useMemo(() => {
    const allOptions = [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'low',
        label: t('settings.openai.verbosity.low')
      },
      {
        value: 'medium',
        label: t('settings.openai.verbosity.medium')
      },
      {
        value: 'high',
        label: t('settings.openai.verbosity.high')
      }
    ] as const satisfies VerbosityOption[]
    const supportedVerbosityLevels = getModelSupportedVerbosity(model).map((v) => toOptionValue(v))
    return allOptions.filter((option) => supportedVerbosityLevels.includes(option.value))
  }, [model, t])

  const serviceTierOptions = useMemo(() => {
    const options = [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
      },
      {
        value: 'auto',
        label: t('settings.openai.service_tier.auto')
      },
      {
        value: 'default',
        label: t('settings.openai.service_tier.default')
      },
      {
        value: 'flex',
        label: t('settings.openai.service_tier.flex')
      },
      {
        value: 'priority',
        label: t('settings.openai.service_tier.priority')
      }
    ] as const satisfies OpenAIServiceTierOption[]
    return options.filter((option) => {
      if (option.value === 'flex') {
        return isSupportFlexServiceTier
      }
      return true
    })
  }, [isSupportFlexServiceTier, t])

  useEffect(() => {
    if (verbosity && !verbosityOptions.some((option) => option.value === verbosity)) {
      const supportedVerbosityLevels = getModelSupportedVerbosity(model)
      // Default to the highest supported verbosity level
      const defaultVerbosity = supportedVerbosityLevels[supportedVerbosityLevels.length - 1]
      setVerbosity(defaultVerbosity)
    }
  }, [model, verbosity, verbosityOptions, setVerbosity])

  if (!showSummarySetting && !showServiceTierSetting && !showVerbositySetting) {
    return null
  }

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
        {showServiceTierSetting && (
          <>
            <SettingRow>
              <SettingRowTitleSmall>
                {t('settings.openai.service_tier.title')}{' '}
                <HelpTooltip content={t('settings.openai.service_tier.tip')} />
              </SettingRowTitleSmall>
              <Selector
                value={toOptionValue(serviceTierMode)}
                onChange={(value) => {
                  setServiceTierMode(toRealValue(value))
                }}
                options={serviceTierOptions}
              />
            </SettingRow>
            {(showSummarySetting || showVerbositySetting) && <SettingDivider />}
          </>
        )}
        {showSummarySetting && (
          <>
            <SettingRow>
              <SettingRowTitleSmall>
                {t('settings.openai.summary_text_mode.title')}{' '}
                <HelpTooltip content={t('settings.openai.summary_text_mode.tip')} />
              </SettingRowTitleSmall>
              <Selector
                value={summaryText}
                onChange={(value) => {
                  setSummaryText(value as OpenAISummaryText)
                }}
                options={summaryTextOptions}
              />
            </SettingRow>
            {showVerbositySetting && <SettingDivider />}
          </>
        )}
        {showVerbositySetting && (
          <SettingRow>
            <SettingRowTitleSmall>
              {t('settings.openai.verbosity.title')} <HelpTooltip content={t('settings.openai.verbosity.tip')} />
            </SettingRowTitleSmall>
            <Selector
              value={verbosity}
              onChange={(value) => {
                setVerbosity(value as OpenAIVerbosity)
              }}
              options={verbosityOptions}
            />
          </SettingRow>
        )}
      </SettingGroup>
      <SettingDivider />
    </CollapsibleSettingGroup>
  )
}

export default OpenAISettingsGroup
