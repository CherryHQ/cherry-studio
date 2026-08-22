import { InputNumber } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { useTranslation } from 'react-i18next'

interface ModelContextWindowFieldsProps {
  contextWindow: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  onContextWindowChange: (value: number | null) => void
  /** Optional: the normalized value always reaches `onContextWindowChange` first. */
  onContextWindowCommit?: (value: number | null) => void
  onMaxInputTokensChange: (value: number | null) => void
  onMaxInputTokensCommit?: (value: number | null) => void
  onMaxOutputTokensChange: (value: number | null) => void
  onMaxOutputTokensCommit?: (value: number | null) => void
}

/** Route InputNumber's normalized result into both controlled state and persistence. */
const settle =
  (onChange: (value: number | null) => void, onCommit?: (value: number | null) => void) => (value: number | null) => {
    onChange(value)
    onCommit?.(value)
  }

export function ModelContextWindowFields({
  contextWindow,
  maxInputTokens,
  maxOutputTokens,
  onContextWindowChange,
  onContextWindowCommit,
  onMaxInputTokensChange,
  onMaxInputTokensCommit,
  onMaxOutputTokensChange,
  onMaxOutputTokensCommit
}: ModelContextWindowFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField
        title={t('settings.models.add.context_window.label')}
        titleClassName={drawerClasses.fieldTitle}
        className={drawerClasses.field}>
        <InputNumber
          min={1}
          step={1}
          aria-label={t('settings.models.add.context_window.label')}
          value={contextWindow}
          placeholder={t('settings.models.add.context_window.placeholder')}
          className={drawerClasses.input}
          onValueChange={onContextWindowChange}
          onBlur={settle(onContextWindowChange, onContextWindowCommit)}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_input_tokens.label')}
        titleClassName={drawerClasses.fieldTitle}
        className={drawerClasses.field}>
        <InputNumber
          min={1}
          step={1}
          aria-label={t('settings.models.add.max_input_tokens.label')}
          value={maxInputTokens}
          placeholder={t('settings.models.add.max_input_tokens.placeholder')}
          className={drawerClasses.input}
          onValueChange={onMaxInputTokensChange}
          onBlur={settle(onMaxInputTokensChange, onMaxInputTokensCommit)}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_output_tokens.label')}
        titleClassName={drawerClasses.fieldTitle}
        className={drawerClasses.field}>
        <InputNumber
          min={1}
          step={1}
          aria-label={t('settings.models.add.max_output_tokens.label')}
          value={maxOutputTokens}
          placeholder={t('settings.models.add.max_output_tokens.placeholder')}
          className={drawerClasses.input}
          onValueChange={onMaxOutputTokensChange}
          onBlur={settle(onMaxOutputTokensChange, onMaxOutputTokensCommit)}
        />
      </ProviderField>
    </>
  )
}
