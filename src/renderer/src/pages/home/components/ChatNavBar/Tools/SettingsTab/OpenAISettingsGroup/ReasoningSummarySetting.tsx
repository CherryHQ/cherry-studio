import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingRowTitleSmall } from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import { SettingRow } from '@renderer/pages/settings'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAIReasoningSummary } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type SummaryTextOption = {
  value: NonNullable<OpenAIReasoningSummary> | 'undefined' | 'null'
  label: string
}

interface Props {
  summaryText: OpenAIReasoningSummary
  disabled?: boolean
  onSummaryTextChange: (value: OpenAIReasoningSummary) => void
}

const ReasoningSummarySetting: FC<Props> = ({ summaryText, disabled, onSummaryTextChange }) => {
  const { t } = useTranslation()

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
      <SettingRowTitleSmall hint={t('settings.openai.summary_text_mode.tip')}>
        {t('settings.openai.summary_text_mode.title')}
      </SettingRowTitleSmall>
      <Select
        disabled={disabled}
        value={toOptionValue(summaryText)}
        onValueChange={(value) => {
          onSummaryTextChange(toRealValue(value as SummaryTextOption['value']))
        }}>
        <SelectTrigger disabled={disabled} size="sm" className="w-45 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-xs">
          {summaryTextOptions.map((option) => (
            <SelectItem className="text-xs" key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

export default ReasoningSummarySetting
