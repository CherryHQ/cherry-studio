import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '../..'

const PADDLEOCR_OCR_MODEL_OPTIONS = ['PP-OCRv6', 'PP-OCRv5'] as const
const PADDLEOCR_DOCUMENT_MODEL_OPTIONS = [
  'PaddleOCR-VL-1.5',
  'PaddleOCR-VL-1.6',
  'PaddleOCR-VL',
  'PP-StructureV3'
] as const

type PaddleOcrModelSettingsProps = {
  feature: 'image_to_text' | 'document_to_markdown'
  value: string
  onChange: (value: string) => void
}

export function PaddleOcrModelSettings({ feature, value, onChange }: PaddleOcrModelSettingsProps) {
  const { t } = useTranslation()

  const modelOptions = feature === 'image_to_text' ? PADDLEOCR_OCR_MODEL_OPTIONS : PADDLEOCR_DOCUMENT_MODEL_OPTIONS
  const trimmedValue = value.trim()
  const selectedValue = trimmedValue || modelOptions[0]

  return (
    <div className="flex flex-col gap-3 border-border-muted border-t pt-4">
      <SettingRow className="items-center gap-4 py-0">
        <SettingRowTitle className="w-24 shrink-0">
          {t('settings.tool.file_processing.processors.paddleocr.fields.parse_model')}
        </SettingRowTitle>
        <div className="min-w-0 flex-1">
          <Select value={selectedValue} onValueChange={onChange}>
            <SelectTrigger
              size="sm"
              aria-label={t('settings.tool.file_processing.processors.paddleocr.fields.parse_model')}
              className="w-full max-w-65">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="w-56">
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model} className="text-sm">
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SettingRow>
    </div>
  )
}
