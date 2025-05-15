import { SettingDivider, SettingRow, SettingSubtitle } from '@renderer/pages/settings'
import { RootState, useAppDispatch } from '@renderer/store'
import { setOpenAIServiceTier, setOpenAISummaryText } from '@renderer/store/settings'
import { OpenAIServiceTier, OpenAISummaryText } from '@renderer/types'
import { Select, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import { SettingGroup, SettingRowTitleSmall } from './SettingsTab'

interface Props {
  isOpenAIReasoning: boolean
}

const OpenAISettingsTab: FC<Props> = (props) => {
  const { t } = useTranslation()
  const summaryText = useSelector((state: RootState) => state.settings.openAI.summaryText)
  const serviceTierMode = useSelector((state: RootState) => state.settings.openAI.serviceTier)
  const dispatch = useAppDispatch()

  const setSummaryText = (value: OpenAISummaryText) => {
    dispatch(setOpenAISummaryText(value))
  }

  const setServiceTierMode = (value: OpenAIServiceTier) => {
    dispatch(setOpenAIServiceTier(value))
  }

  const summaryTextOptions = [
    {
      value: 'auto',
      label: t('settings.openai.summary_text_mode.auto')
    },
    {
      value: 'concise',
      label: t('settings.openai.summary_text_mode.concise')
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

  const serviceTierOptions = [
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
