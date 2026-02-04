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
import { FILE_PROCESSOR_CONFIG, TESSERACT_LANG_MAP } from '@renderer/config/fileProcessing'
import { useFileProcessor } from '@renderer/hooks/useFileProcessing'
import useTranslate from '@renderer/hooks/useTranslate'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ProcessorSettingsLayout from '../ProcessorSettingsLayout'

interface BuiltinProcessorSettingsProps {
  processorId: string
}

const BuiltinProcessorSettings: FC<BuiltinProcessorSettingsProps> = ({ processorId }) => {
  const { t } = useTranslation()
  const { translateLanguages } = useTranslate()
  const { processor, updateProcessor } = useFileProcessor(processorId)

  const currentLangs = (processor?.options?.langs as string[]) || []

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

  const systemLangOptions: ComboboxOption[] = useMemo(
    () =>
      translateLanguages.map((lang) => ({
        value: lang.langCode,
        label: `${lang.emoji} ${lang.label()}`
      })),
    [translateLanguages]
  )

  if (!processor) return null

  const handleLangsChange = (values: string | string[]) => {
    updateProcessor({
      options: {
        ...processor.options,
        langs: values as string[]
      }
    })
  }

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

  return (
    <ProcessorSettingsLayout.Root
      title={t(`settings.file_processing.processor.${processor.id}.name`)}
      officialUrl={FILE_PROCESSOR_CONFIG[processor.id]?.websites.official}>
      <ProcessorSettingsLayout.Header />
      <ProcessorSettingsLayout.Content>{renderProcessorSettings()}</ProcessorSettingsLayout.Content>
    </ProcessorSettingsLayout.Root>
  )
}

export default BuiltinProcessorSettings
