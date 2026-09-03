import { Button, InputNumber, Tooltip } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { useTranslation } from 'react-i18next'

interface TokenLimitPreset {
  label: string
  value: number
}

const CONTEXT_WINDOW_PRESETS: readonly TokenLimitPreset[] = [
  { label: '128K', value: 128000 },
  { label: '200K', value: 200000 },
  { label: '256K', value: 262144 },
  { label: '400K', value: 400000 },
  { label: '512K', value: 524288 },
  { label: '1M', value: 1000000 }
]

const MAX_INPUT_TOKEN_PRESETS: readonly TokenLimitPreset[] = [
  { label: '128K', value: 128000 },
  { label: '200K', value: 200000 },
  { label: '256K', value: 256000 },
  { label: '512K', value: 512000 },
  { label: '1M', value: 1000000 }
]

const MAX_OUTPUT_TOKEN_PRESETS: readonly TokenLimitPreset[] = [
  { label: '16K', value: 16384 },
  { label: '32K', value: 32768 },
  { label: '64K', value: 65536 },
  { label: '128K', value: 128000 },
  { label: '256K', value: 256000 }
]

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

interface TokenLimitFieldProps {
  title: string
  presetsLabel: string
  value: number | null
  placeholder: string
  presets: readonly TokenLimitPreset[]
  onChange: (value: number | null) => void
  onCommit?: (value: number | null) => void
}

function TokenLimitField({
  title,
  presetsLabel,
  value,
  placeholder,
  presets,
  onChange,
  onCommit
}: TokenLimitFieldProps) {
  const settle = (settled: number | null) => {
    onChange(settled)
    onCommit?.(settled)
  }

  return (
    <ProviderField title={title} titleClassName={drawerClasses.fieldTitle} className={drawerClasses.field}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${title} ${presetsLabel}`}>
        {presets.map((preset) => {
          const active = value === preset.value

          return (
            <Tooltip key={preset.value} content={String(preset.value)}>
              <Button
                type="button"
                variant={active ? 'secondary' : 'outline'}
                size="sm"
                aria-label={`${title}: ${preset.label} (${preset.value})`}
                aria-pressed={active}
                className="rounded-full"
                onClick={() => settle(preset.value)}>
                {preset.label}
              </Button>
            </Tooltip>
          )
        })}
      </div>
      <InputNumber
        min={1}
        step={1}
        aria-label={title}
        value={value}
        placeholder={placeholder}
        className={drawerClasses.input}
        onValueChange={onChange}
        onBlur={settle}
      />
    </ProviderField>
  )
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
  const quickPresetsLabel = t('settings.models.add.quick_presets')

  return (
    <>
      <TokenLimitField
        title={t('settings.models.add.context_window.label')}
        presetsLabel={quickPresetsLabel}
        value={contextWindow}
        placeholder={t('settings.models.add.context_window.placeholder')}
        presets={CONTEXT_WINDOW_PRESETS}
        onChange={onContextWindowChange}
        onCommit={onContextWindowCommit}
      />
      <TokenLimitField
        title={t('settings.models.add.max_input_tokens.label')}
        presetsLabel={quickPresetsLabel}
        value={maxInputTokens}
        placeholder={t('settings.models.add.max_input_tokens.placeholder')}
        presets={MAX_INPUT_TOKEN_PRESETS}
        onChange={onMaxInputTokensChange}
        onCommit={onMaxInputTokensCommit}
      />
      <TokenLimitField
        title={t('settings.models.add.max_output_tokens.label')}
        presetsLabel={quickPresetsLabel}
        value={maxOutputTokens}
        placeholder={t('settings.models.add.max_output_tokens.placeholder')}
        presets={MAX_OUTPUT_TOKEN_PRESETS}
        onChange={onMaxOutputTokensChange}
        onCommit={onMaxOutputTokensCommit}
      />
    </>
  )
}
