import { InputNumber } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { useTranslation } from 'react-i18next'

interface ModelContextWindowFieldsProps {
  contextWindow: string
  maxInputTokens: string
  maxOutputTokens: string
  onContextWindowChange: (value: string) => void
  onContextWindowBlur?: () => void
  onMaxInputTokensChange: (value: string) => void
  onMaxInputTokensBlur?: () => void
  onMaxOutputTokensChange: (value: string) => void
  onMaxOutputTokensBlur?: () => void
}

export function ModelContextWindowFields({
  contextWindow,
  maxInputTokens,
  maxOutputTokens,
  onContextWindowChange,
  onContextWindowBlur,
  onMaxInputTokensChange,
  onMaxInputTokensBlur,
  onMaxOutputTokensChange,
  onMaxOutputTokensBlur
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
          onBlur={onContextWindowBlur}
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
          onBlur={onMaxInputTokensBlur}
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
          onBlur={onMaxOutputTokensBlur}
        />
      </ProviderField>
    </>
  )
}
