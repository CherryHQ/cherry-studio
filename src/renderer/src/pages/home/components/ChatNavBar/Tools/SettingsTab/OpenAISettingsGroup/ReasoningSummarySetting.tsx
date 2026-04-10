import Selector from '@renderer/components/Selector'
import { SettingRow } from '@renderer/pages/settings'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setOpenAISummaryText } from '@renderer/store/settings'
import type { OpenAIReasoningSummary } from '@renderer/types/aiCoreTypes'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

type SummaryTextOption = {
  value: NonNullable<OpenAIReasoningSummary> | 'undefined' | 'null'
  label: string
}

interface Props {
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const ReasoningSummarySetting: FC<Props> = ({ SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const summaryText = useSelector((state: RootState) => state.settings.openAI.summaryText)
  const dispatch = useAppDispatch()

  const setSummaryText = useCallback(
    (value: OpenAIReasoningSummary) => {
      dispatch(setOpenAISummaryText(value))
    },
    [dispatch]
  )

  const summaryTextOptions = [
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

  return (
    <SettingRow>
      <SettingRowTitleSmall>
        {t('settings.openai.summary_text_mode.title')}{' '}
        <Tooltip title={t('settings.openai.summary_text_mode.tip')}>
          <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
        </Tooltip>
      </SettingRowTitleSmall>
      <Selector
        value={toOptionValue(summaryText)}
        onChange={(value) => {
          setSummaryText(toRealValue(value))
        }}
        options={summaryTextOptions}
      />
    </SettingRow>
  )
}

export default ReasoningSummarySetting
