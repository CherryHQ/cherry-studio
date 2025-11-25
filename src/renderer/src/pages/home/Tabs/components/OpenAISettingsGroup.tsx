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
import { OpenAIServiceTiers, SystemProviderIds } from '@renderer/types'
import type { OpenAISummaryText, OpenAIVerbosity } from '@renderer/types/aiCoreTypes'
import { isSupportServiceTierProvider, isSupportVerbosityProvider } from '@renderer/utils/provider'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

type VerbosityOption = {
  value: OpenAIVerbosity
  label: string
}

type SummaryTextOption = {
  value: OpenAISummaryText
  label: string
}

type OpenAIServiceTierOption = { value: OpenAIServiceTier; label: string }

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
    (provider.type === 'openai-response' || provider.id === 'aihubmix')
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
      value: undefined,
      label: t('common.default')
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
        value: undefined,
        label: t('common.default')
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
    const supportedVerbosityLevels = getModelSupportedVerbosity(model)
    return allOptions.filter((option) => supportedVerbosityLevels.includes(option.value))
  }, [model, t])

  const serviceTierOptions = useMemo(() => {
    const options = [
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
    if (serviceTierMode && !serviceTierOptions.some((option) => option.value === serviceTierMode)) {
      setServiceTierMode(OpenAIServiceTiers.auto)
    }
  }, [provider.id, serviceTierMode, serviceTierOptions, setServiceTierMode])

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
                <Tooltip title={t('settings.openai.service_tier.tip')}>
                  <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
                </Tooltip>
              </SettingRowTitleSmall>
              <Selector
                value={serviceTierMode}
                onChange={(value) => {
                  setServiceTierMode(value as OpenAIServiceTier)
                }}
                options={serviceTierOptions}
                placeholder={t('settings.openai.service_tier.auto')}
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
                <Tooltip title={t('settings.openai.summary_text_mode.tip')}>
                  <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
                </Tooltip>
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
              {t('settings.openai.verbosity.title')}{' '}
              <Tooltip title={t('settings.openai.verbosity.tip')}>
                <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
              </Tooltip>
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
