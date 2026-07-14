import { Input } from '@cherrystudio/ui'
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
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.context_window.label')}
          value={contextWindow}
          placeholder={t('settings.models.add.context_window.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onContextWindowChange(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={onContextWindowBlur}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_input_tokens.label')}
        titleClassName={drawerClasses.fieldTitle}
        className={drawerClasses.field}>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_input_tokens.label')}
          value={maxInputTokens}
          placeholder={t('settings.models.add.max_input_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxInputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={onMaxInputTokensBlur}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_output_tokens.label')}
        titleClassName={drawerClasses.fieldTitle}
        className={drawerClasses.field}>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_output_tokens.label')}
          value={maxOutputTokens}
          placeholder={t('settings.models.add.max_output_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxOutputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={onMaxOutputTokensBlur}
        />
      </ProviderField>
    </>
  )
}
