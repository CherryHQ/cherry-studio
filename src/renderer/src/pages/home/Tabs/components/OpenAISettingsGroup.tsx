import Selector from '@renderer/components/Selector'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setOpenAIServiceTier, setOpenAISummaryText } from '@renderer/store/settings'
import { OpenAIServiceTier, OpenAISummaryText } from '@renderer/types'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

interface Props {
  isOpenAIReasoning: boolean
  isSupportedFlexServiceTier: boolean
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const FALL_BACK_SERVICE_TIER: Record<OpenAIServiceTier, OpenAIServiceTier> = {
  auto: 'auto',
  default: 'default',
  flex: 'default'
}

const OpenAISettingsGroup: FC<Props> = ({
  isOpenAIReasoning,
  isSupportedFlexServiceTier,
  SettingGroup,
  SettingRowTitleSmall
}) => {
  const { t } = useTranslation()
  const summaryText = useSelector((state: RootState) => state.settings.openAI.summaryText)
  const serviceTierMode = useSelector((state: RootState) => state.settings.openAI.serviceTier)
  const dispatch = useAppDispatch()

  const setSummaryText = useCallback(
    (value: OpenAISummaryText) => {
      dispatch(setOpenAISummaryText(value))
    },
    [dispatch]
  )

  const setServiceTierMode = useCallback(
    (value: OpenAIServiceTier) => {
      dispatch(setOpenAIServiceTier(value))
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

  const serviceTierOptions = useMemo(() => {
    const baseOptions = [
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
      }
    ]
    return baseOptions.filter((option) => {
      if (option.value === 'flex') {
        return isSupportedFlexServiceTier
      }
      return true
    })
  }, [isSupportedFlexServiceTier, t])

  useEffect(() => {
    if (serviceTierMode && !serviceTierOptions.some((option) => option.value === serviceTierMode)) {
      setServiceTierMode(FALL_BACK_SERVICE_TIER[serviceTierMode])
    }
  }, [serviceTierMode, serviceTierOptions, setServiceTierMode])

  return (
    <CollapsibleSettingGroup title={t('settings.openai.title')} defaultExpanded={true}>
      <SettingGroup>
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
          />
        </SettingRow>
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
