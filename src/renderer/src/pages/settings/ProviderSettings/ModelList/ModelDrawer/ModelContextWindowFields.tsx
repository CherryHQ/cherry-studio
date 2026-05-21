import { useTranslation } from 'react-i18next'

import ProviderField from '../../primitives/ProviderField'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'

interface ModelContextWindowFieldsProps {
  contextWindow: string
  maxInputTokens: string
  maxOutputTokens: string
  onContextWindowChange: (value: string) => void
  onMaxInputTokensChange: (value: string) => void
  onMaxOutputTokensChange: (value: string) => void
}

const drawerFieldTitleClassName = 'text-[13px] text-foreground/85'

export function ModelContextWindowFields({
  contextWindow,
  maxInputTokens,
  maxOutputTokens,
  onContextWindowChange,
  onMaxInputTokensChange,
  onMaxOutputTokensChange
}: ModelContextWindowFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField title={t('settings.models.add.context_window.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.context_window.label')}
          value={contextWindow}
          placeholder={t('settings.models.add.context_window.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onContextWindowChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>

      <ProviderField title={t('settings.models.add.max_input_tokens.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_input_tokens.label')}
          value={maxInputTokens}
          placeholder={t('settings.models.add.max_input_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxInputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.max_output_tokens.label')}
        titleClassName={drawerFieldTitleClassName}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          aria-label={t('settings.models.add.max_output_tokens.label')}
          value={maxOutputTokens}
          placeholder={t('settings.models.add.max_output_tokens.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onMaxOutputTokensChange(event.target.value.replace(/[^\d]/g, ''))}
        />
      </ProviderField>
    </>
  )
}
