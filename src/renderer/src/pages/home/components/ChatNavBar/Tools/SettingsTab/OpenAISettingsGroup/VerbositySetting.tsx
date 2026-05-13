import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { getModelSupportedVerbosity } from '@renderer/config/models'
import { SettingRow } from '@renderer/pages/settings'
import type { Model } from '@renderer/types'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAIVerbosity } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type VerbosityOption = {
  value: NonNullable<OpenAIVerbosity> | 'undefined' | 'null'
  label: string
}

interface Props {
  model: Model
  verbosity: OpenAIVerbosity
  disabled?: boolean
  onVerbosityChange: (value: OpenAIVerbosity) => void
  SettingRowTitleSmall: FC<{ children: React.ReactNode; hint?: string }>
}

const VerbositySetting: FC<Props> = ({ model, verbosity, disabled, onVerbosityChange, SettingRowTitleSmall }) => {
  const { t } = useTranslation()

  const setVerbosity = useCallback(
    (value: OpenAIVerbosity) => {
      onVerbosityChange(value)
    },
    [onVerbosityChange]
  )

  const verbosityOptions = useMemo(() => {
    const allOptions = [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
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

  useEffect(() => {
    if (verbosity !== undefined && !verbosityOptions.some((option) => option.value === toOptionValue(verbosity))) {
      const supportedVerbosityLevels = getModelSupportedVerbosity(model)
      // Default to the highest supported verbosity level
      const defaultVerbosity = supportedVerbosityLevels[supportedVerbosityLevels.length - 1]
      setVerbosity(defaultVerbosity)
    }
  }, [model, verbosity, verbosityOptions, setVerbosity])

  return (
    <SettingRow>
      <SettingRowTitleSmall hint={t('settings.openai.verbosity.tip')}>
        {t('settings.openai.verbosity.title')}
      </SettingRowTitleSmall>
      <Select
        disabled={disabled}
        value={toOptionValue(verbosity)}
        onValueChange={(value) => {
          setVerbosity(toRealValue(value as VerbosityOption['value']))
        }}>
        <SelectTrigger disabled={disabled} size="sm" className="w-45 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-xs">
          {verbosityOptions.map((option) => (
            <SelectItem className="text-xs" key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

export default VerbositySetting
