import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingRow } from '@renderer/pages/settings'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAICompletionsStreamOptions } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type IncludeUsageOption = {
  value: 'undefined' | 'false' | 'true'
  label: string
}

interface Props {
  includeUsage: OpenAICompletionsStreamOptions['include_usage']
  disabled?: boolean
  onIncludeUsageChange: (value: OpenAICompletionsStreamOptions['include_usage']) => void
  SettingRowTitleSmall: FC<{ children: React.ReactNode; hint?: string }>
}

const StreamOptionsSetting: FC<Props> = ({ includeUsage, disabled, onIncludeUsageChange, SettingRowTitleSmall }) => {
  const { t } = useTranslation()

  const setIncludeUsage = useCallback(
    (value: OpenAICompletionsStreamOptions['include_usage']) => {
      onIncludeUsageChange(value)
    },
    [onIncludeUsageChange]
  )

  const includeUsageOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'false',
        label: t('common.off')
      },
      {
        value: 'true',
        label: t('common.on')
      }
    ] as const satisfies IncludeUsageOption[]
  }, [t])

  return (
    <SettingRow>
      <SettingRowTitleSmall hint={t('settings.openai.stream_options.include_usage.tip')}>
        {t('settings.openai.stream_options.include_usage.title')}
      </SettingRowTitleSmall>
      <Select
        disabled={disabled}
        value={toOptionValue(includeUsage)}
        onValueChange={(value) => {
          setIncludeUsage(toRealValue(value as IncludeUsageOption['value']))
        }}>
        <SelectTrigger disabled={disabled} size="sm" className="w-45 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-xs">
          {includeUsageOptions.map((option) => (
            <SelectItem className="text-xs" key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

export default StreamOptionsSetting
