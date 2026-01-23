import {
  Badge,
  Combobox,
  type ComboboxOption,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  InfoTooltip
} from '@cherrystudio/ui'
import { isMac, isWin } from '@renderer/config/constant'
import { TESSERACT_LANG_MAP } from '@renderer/config/ocr'
import useTranslate from '@renderer/hooks/useTranslate'
import type { FileProcessorMerged, FileProcessorOverride } from '@shared/data/presets/fileProcessing'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface BuiltinProcessorSettingsContentProps {
  processor: FileProcessorMerged
  updateConfig: (update: FileProcessorOverride) => void
}

const BuiltinProcessorSettingsContent: FC<BuiltinProcessorSettingsContentProps> = ({ processor, updateConfig }) => {
  const { t } = useTranslation()
  const { translateLanguages } = useTranslate()

  // Get current langs from processor.options
  const currentLangs = (processor.options?.langs as string[]) || []

  // Build options for Tesseract (uses TesseractLangCode)
  const tesseractLangOptions: ComboboxOption[] = useMemo(
    () =>
      translateLanguages
        .filter((lang) => TESSERACT_LANG_MAP[lang.langCode])
        .map((lang) => ({
          value: TESSERACT_LANG_MAP[lang.langCode],
          label: `${lang.emoji} ${lang.label()}`
        })),
    [translateLanguages]
  )

  // Build options for System OCR (uses TranslateLanguageCode directly)
  const systemLangOptions: ComboboxOption[] = useMemo(
    () =>
      translateLanguages.map((lang) => ({
        value: lang.langCode,
        label: `${lang.emoji} ${lang.label()}`
      })),
    [translateLanguages]
  )

  // Handle language change
  const handleLangsChange = (values: string | string[]) => {
    updateConfig({
      options: {
        ...processor.options,
        langs: values as string[]
      }
    })
  }

  // Render Tesseract settings
  const renderTesseractSettings = () => (
    <FieldGroup className="px-4 py-2">
      <Field>
        <FieldLabel className="flex items-center gap-1">
          {t('settings.file_processing.langs')}
          <InfoTooltip content={t('settings.file_processing.langs_tooltip')} />
        </FieldLabel>
        <FieldContent>
          <Combobox
            multiple
            options={tesseractLangOptions}
            value={currentLangs}
            onChange={handleLangsChange}
            placeholder={t('settings.file_processing.langs_placeholder')}
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )

  // Render System OCR settings (Windows: language selector, Mac: no config needed)
  const renderSystemSettings = () => {
    if (!isWin && !isMac) return null

    return (
      <FieldGroup className="px-4 py-2">
        <Field>
          <FieldLabel className="flex items-center gap-1">
            {t('settings.file_processing.langs')}
            {isWin && <InfoTooltip content={t('settings.file_processing.system_langs_tooltip')} />}
          </FieldLabel>
          <FieldContent>
            {isMac ? (
              <Badge className="gap-1 rounded-3xs border border-primary/20 bg-primary/10 text-primary">
                {t('settings.file_processing.no_config_needed')}
              </Badge>
            ) : (
              <Combobox
                multiple
                options={systemLangOptions}
                value={currentLangs}
                onChange={handleLangsChange}
                placeholder={t('settings.file_processing.langs_placeholder')}
              />
            )}
          </FieldContent>
        </Field>
      </FieldGroup>
    )
  }

  // Render OV OCR settings (fixed supported languages)
  const renderOvOcrSettings = () => (
    <FieldGroup className="px-4 py-2">
      <Field>
        <FieldLabel>{t('settings.file_processing.langs')}</FieldLabel>
        <FieldContent>
          <div className="flex flex-wrap gap-2">
            <Badge>
              {'\u{1F1EC}\u{1F1E7}'} {t('languages.english')}
            </Badge>
            <Badge>
              {'\u{1F1E8}\u{1F1F3}'} {t('languages.chinese')}
            </Badge>
            <Badge>
              {'\u{1F1ED}\u{1F1F0}'} {t('languages.chinese-traditional')}
            </Badge>
          </div>
        </FieldContent>
      </Field>
    </FieldGroup>
  )

  // Render settings based on processor ID
  const renderProcessorSettings = () => {
    switch (processor.id) {
      case 'tesseract':
        return renderTesseractSettings()
      case 'system':
        return renderSystemSettings()
      case 'ovocr':
        return renderOvOcrSettings()
      default:
        return null
    }
  }

  return renderProcessorSettings()
}

export default BuiltinProcessorSettingsContent
