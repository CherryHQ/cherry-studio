import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle, SettingSubtitle } from '../..'

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
    <>
      <SettingSubtitle>{t('settings.tool.file_processing.sections.model_parameters')}</SettingSubtitle>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.file_processing.processors.paddleocr.fields.parse_model')}</SettingRowTitle>
        <Select value={selectedValue} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            aria-label={t('settings.tool.file_processing.processors.paddleocr.fields.parse_model')}
            className="min-w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" className="w-56">
            {PADDLEOCR_MODEL_OPTIONS.map((model) => (
              <SelectItem key={model} value={model} className="text-sm">
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </>
  )
}
