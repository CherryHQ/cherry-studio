import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { SettingsSection } from './SettingsSection'

const PADDLEOCR_MODEL_OPTIONS = ['PaddleOCR-VL-1.5', 'PaddleOCR-VL', 'PP-StructureV3', 'PP-OCRv5'] as const

type PaddleOCRModelSettingsProps = {
  value: string
  onChange: (value: string) => void
}

export function PaddleOCRModelSettings({ value, onChange }: PaddleOCRModelSettingsProps) {
  const { t } = useTranslation()

  const trimmedValue = value.trim()
  const selectedValue = trimmedValue || PADDLEOCR_MODEL_OPTIONS[0]

  return (
    <SettingsSection title={t('settings.tool.file_processing.sections.model_parameters')}>
      <div>
        <div className="mb-1.5">
          <label className="text-foreground/55 text-xs leading-tight">
            {t('settings.tool.file_processing.paddleocr.parse_model')}
          </label>
        </div>
        <Select value={selectedValue} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            aria-label={t('settings.tool.file_processing.paddleocr.parse_model')}
            className="h-auto min-h-0 min-w-[150px] rounded-full border-0 bg-foreground/[0.06] px-3 py-[5px] text-foreground/55 text-xs leading-tight shadow-none hover:bg-foreground/[0.08] hover:text-foreground/65">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" className="w-56">
            {PADDLEOCR_MODEL_OPTIONS.map((model) => (
              <SelectItem key={model} value={model} className="text-xs">
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SettingsSection>
  )
}
