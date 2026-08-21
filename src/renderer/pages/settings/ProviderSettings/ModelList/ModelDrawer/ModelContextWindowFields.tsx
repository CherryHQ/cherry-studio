import { InputNumber } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { useTranslation } from 'react-i18next'

interface ModelContextWindowFieldsProps {
  contextWindow: string
  maxInputTokens: string
  maxOutputTokens: string
  onContextWindowChange: (value: string) => void
  /** Optional: the normalized value always reaches `onContextWindowChange` first. */
  onContextWindowCommit?: (value: string) => void
  onMaxInputTokensChange: (value: string) => void
  onMaxInputTokensCommit?: (value: string) => void
  onMaxOutputTokensChange: (value: string) => void
  onMaxOutputTokensCommit?: (value: string) => void
}

/**
 * `InputNumber` renders `value`, not its own normalized result, so the settled
 * value has to go back through the change callback or the field keeps showing
 * what was typed — a decimal in an integer field, a number below `min`.
 */
const settle = (onChange: (value: string) => void, onCommit?: (value: string) => void) => (value: number | null) => {
  const next = value === null ? '' : String(value)
  onChange(next)
  onCommit?.(next)
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
          value={contextWindow === '' ? null : Number(contextWindow)}
          placeholder={t('settings.models.add.context_window.placeholder')}
          className={drawerClasses.input}
          onChange={(value) => onContextWindowChange(value === null ? '' : String(value))}
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
          value={maxInputTokens === '' ? null : Number(maxInputTokens)}
          placeholder={t('settings.models.add.max_input_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(value) => onMaxInputTokensChange(value === null ? '' : String(value))}
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
          value={maxOutputTokens === '' ? null : Number(maxOutputTokens)}
          placeholder={t('settings.models.add.max_output_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(value) => onMaxOutputTokensChange(value === null ? '' : String(value))}
          onBlur={settle(onMaxOutputTokensChange, onMaxOutputTokensCommit)}
        />
      </ProviderField>
    </>
  )
}
