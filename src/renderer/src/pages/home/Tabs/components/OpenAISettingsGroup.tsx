import Selector from '@renderer/components/Selector'
import { isSupportedReasoningEffortOpenAIModel, isSupportFlexServiceTierModel } from '@renderer/config/models'
import { isSupportServiceTierProvider } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setOpenAISummaryText } from '@renderer/store/settings'
import {
  GroqServiceTiers,
  Model,
  OpenAIServiceTier,
  OpenAIServiceTiers,
  OpenAISummaryText,
  ServiceTier,
  SystemProviderIds
} from '@renderer/types'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo } from 'react'
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
  const summaryText = useSelector((state: RootState) => state.settings.openAI.summaryText)
  const serviceTierMode = provider.serviceTier
  const dispatch = useAppDispatch()

  const isOpenAIReasoning =
    isSupportedReasoningEffortOpenAIModel(model) &&
    !model.id.includes('o1-pro') &&
    (provider.type === 'openai-response' || provider.id === 'aihubmix')
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

  if (!isOpenAIReasoning && !isSupportServiceTier) {
    return null
  }

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
        {isSupportServiceTier && (
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
        )}
        {isOpenAIReasoning && (
          <>
            <SettingDivider />
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
          </>
        )}
      </SettingGroup>
      <SettingDivider />
    </CollapsibleSettingGroup>
  )
}

export default OpenAISettingsGroup
