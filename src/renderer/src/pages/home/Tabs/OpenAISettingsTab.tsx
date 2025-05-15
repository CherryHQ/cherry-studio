import { SettingDivider, SettingRow, SettingSubtitle } from '@renderer/pages/settings'
import { RootState, useAppDispatch } from '@renderer/store'
import { setOpenAIServiceTier, setOpenAISummaryText } from '@renderer/store/settings'
import { OpenAIServiceTier, OpenAISummaryText } from '@renderer/types'
import { Select, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import { SettingGroup, SettingRowTitleSmall } from './SettingsTab'

interface Props {
  isOpenAIReasoning: boolean
  isSupportedFlexServiceTier: boolean
}

const FALL_BACK_SERVICE_TIER: Record<OpenAIServiceTier, OpenAIServiceTier> = {
  auto: 'auto',
  default: 'default',
  flex: 'default'
}

const OpenAISettingsTab: FC<Props> = (props) => {
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
        return props.isSupportedFlexServiceTier
      }
      return true
    })
  }, [props.isSupportedFlexServiceTier, t])

  useEffect(() => {
    if (serviceTierMode && !serviceTierOptions.some((option) => option.value === serviceTierMode)) {
      setServiceTierMode(FALL_BACK_SERVICE_TIER[serviceTierMode])
    }
  }, [serviceTierMode, serviceTierOptions, setServiceTierMode])

  return (
    <SettingGroup>
      <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.openai.title')}</SettingSubtitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitleSmall>
          {t('settings.openai.service_tier.title')}{' '}
          <Tooltip title={t('settings.openai.service_tier.tip')}>
            <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
          </Tooltip>
        </SettingRowTitleSmall>
        <StyledSelect
          value={serviceTierMode}
          style={{ width: 135 }}
          onChange={(value) => {
            setServiceTierMode(value as OpenAIServiceTier)
          }}
          size="small"
          options={serviceTierOptions}
        />
      </SettingRow>
      {props.isOpenAIReasoning && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>
              {t('settings.openai.summary_text_mode.title')}{' '}
              <Tooltip title={t('settings.openai.summary_text_mode.tip')}>
                <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
              </Tooltip>
            </SettingRowTitleSmall>
            <StyledSelect
              value={summaryText}
              style={{ width: 135 }}
              onChange={(value) => {
                setSummaryText(value as OpenAISummaryText)
              }}
              size="small"
              options={summaryTextOptions}
            />
          </SettingRow>
        </>
      )}
    </SettingGroup>
  )
}

const StyledSelect = styled(Select)`
  .ant-select-selector {
    border-radius: 15px !important;
    padding: 4px 10px !important;
    height: 26px !important;
  }
`

export default OpenAISettingsTab
