import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { getModelSupportedVerbosity } from '@renderer/config/models'
import { SettingRowTitleSmall } from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import { SettingRow } from '@renderer/pages/settings'
import type { Model } from '@renderer/types'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAIVerbosity } from '@shared/types/aiSdk'
import type { FC } from 'react'
import { useMemo } from 'react'
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
}

const VerbositySetting: FC<Props> = ({ model, verbosity, disabled, onVerbosityChange }) => {
  const { t } = useTranslation()

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

  // Derive the displayed value at render time. Auto-correcting an unsupported
  // saved value via useEffect would persist a DB write on every model switch
  // (no debounce, no rollback, alert with the wrong intent). Render-deriving
  // here keeps the UI showing a legal value; the store is only updated when
  // the user actually picks a new verbosity below.
  const effectiveVerbosity = useMemo<OpenAIVerbosity>(() => {
    if (verbosity === undefined) return verbosity
    if (verbosityOptions.some((option) => option.value === toOptionValue(verbosity))) {
      return verbosity
    }
    const supported = getModelSupportedVerbosity(model)
    return supported[supported.length - 1]
  }, [verbosity, verbosityOptions, model])

  return (
    <SettingRow>
      <SettingRowTitleSmall hint={t('settings.openai.verbosity.tip')}>
        {t('settings.openai.verbosity.title')}
      </SettingRowTitleSmall>
      <Select
        disabled={disabled}
        value={toOptionValue(effectiveVerbosity)}
        onValueChange={(value) => {
          onVerbosityChange(toRealValue(value as VerbosityOption['value']))
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
