import { HelpTooltip } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import {
  getModelSupportedVerbosity,
  isSupportedReasoningEffortOpenAIModel,
  isSupportFlexServiceTierModel,
  isSupportVerbosityModel
} from '@renderer/config/models'
import { isSupportServiceTierProvider } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setOpenAISummaryText, setOpenAIVerbosity } from '@renderer/store/settings'
import type { Model, OpenAIServiceTier, OpenAISummaryText, ServiceTier } from '@renderer/types'
import { GroqServiceTiers, OpenAIServiceTiers, SystemProviderIds } from '@renderer/types'
import type { OpenAIVerbosity } from '@types'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

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

  const isOpenAIReasoning =
    isSupportedReasoningEffortOpenAIModel(model) &&
    !model.id.includes('o1-pro') &&
    (provider.type === 'openai-response' || provider.id === 'aihubmix')
  const isSupportVerbosity = isSupportVerbosityModel(model)
  const isSupportServiceTier = isSupportServiceTierProvider(provider)
  const isSupportedFlexServiceTier = isSupportFlexServiceTierModel(model)

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
      value: 'auto',
      label: t('settings.openai.summary_text_mode.auto')
    },
    {
      value: 'detailed',
      label: t('settings.openai.summary_text_mode.detailed')
    },
    {
      value: 'off',
      label: t('settings.openai.summary_text_mode.off')
    }
  ]

  const verbosityOptions = useMemo(() => {
    const allOptions = [
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
    ]
    const supportedVerbosityLevels = getModelSupportedVerbosity(model)
    return allOptions.filter((option) => supportedVerbosityLevels.includes(option.value as any))
  }, [model, t])

  const serviceTierOptions = useMemo(() => {
    let baseOptions: { value: ServiceTier; label: string }[]
    if (provider.id === SystemProviderIds.groq) {
      baseOptions = [
        {
          value: 'auto',
          label: t('settings.openai.service_tier.auto')
        },
        {
          value: 'on_demand',
          label: t('settings.openai.service_tier.on_demand')
        },
        {
          value: 'flex',
          label: t('settings.openai.service_tier.flex')
        },
        {
          value: 'performance',
          label: t('settings.openai.service_tier.performance')
        }
      ]
    } else {
      // 其他情况默认是和 OpenAI 相同
      baseOptions = [
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
      ]
    }
    return baseOptions.filter((option) => {
      if (option.value === 'flex') {
        return isSupportedFlexServiceTier
      }
      return true
    })
  }, [isSupportedFlexServiceTier, provider.id, t])

  useEffect(() => {
    if (serviceTierMode && !serviceTierOptions.some((option) => option.value === serviceTierMode)) {
      if (provider.id === SystemProviderIds.groq) {
        setServiceTierMode(GroqServiceTiers.on_demand)
      } else {
        setServiceTierMode(OpenAIServiceTiers.auto)
      }
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

  if (!isOpenAIReasoning && !isSupportServiceTier && !isSupportVerbosity) {
    return null
  }

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
        {isSupportServiceTier && (
          <>
            <SettingRow>
              <SettingRowTitleSmall>
                {t('settings.openai.service_tier.title')}{' '}
                <HelpTooltip content={t('settings.openai.service_tier.tip')} />
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
            {(isOpenAIReasoning || isSupportVerbosity) && <SettingDivider />}
          </>
        )}
        {isOpenAIReasoning && (
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
            {isSupportVerbosity && <SettingDivider />}
          </>
        )}
        {isSupportVerbosity && (
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
