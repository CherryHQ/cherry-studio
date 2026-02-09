import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useDefaultProcessors, useFileProcessors } from '@renderer/hooks/useFileProcessing'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ScenarioSection from './ScenarioSection'

const GeneralSettings: FC = () => {
  const { t } = useTranslation()
  const { processors: documentProcessors } = useFileProcessors({ feature: 'markdown_conversion' })
  const { processors: imageProcessors } = useFileProcessors({ feature: 'text_extraction' })
  const {
    defaultMarkdownConversionProcessor,
    setDefaultMarkdownConversionProcessor,
    defaultTextExtractionProcessor,
    setDefaultTextExtractionProcessor
  } = useDefaultProcessors()

  // Filter document processors that are configured (have apiKeys or are builtin)
  const availableDocumentProcessors = documentProcessors.filter(
    (p) => p.type === 'builtin' || (p.apiKeys && p.apiKeys.length > 0)
  )

  // Filter image processors that are configured (have apiKeys or are builtin)
  const availableImageProcessors = imageProcessors.filter(
    (p) => p.type === 'builtin' || (p.apiKeys && p.apiKeys.length > 0)
  )

  return (
    <div className="flex w-full flex-col gap-1">
      {/* Knowledge Base Document Processing */}
      <ScenarioSection.Root
        title={t('settings.file_processing.feature.markdown_conversion.title')}
        description={t('settings.file_processing.feature.markdown_conversion.description')}>
        <ScenarioSection.Title />
        <ScenarioSection.Row>
          <ScenarioSection.Description />
          <Select
            value={defaultMarkdownConversionProcessor || '__none__'}
            onValueChange={(value) => setDefaultMarkdownConversionProcessor(value === '__none__' ? null : value)}>
            <SelectTrigger className="w-50 rounded-2xs">
              <SelectValue placeholder={t('settings.file_processing.no_default')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t('settings.file_processing.no_default')}</SelectItem>
              {availableDocumentProcessors.map((processor) => (
                <SelectItem key={processor.id} value={processor.id}>
                  {t(`settings.file_processing.processor.${processor.id}.name`)}
                  {processor.type === 'builtin' ? ` (${t('settings.file_processing.builtin')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ScenarioSection.Row>
      </ScenarioSection.Root>

      <div className="border-border border-b" />

      {/* Chat Image Understanding */}
      <ScenarioSection.Root
        title={t('settings.file_processing.feature.text_extraction.title')}
        description={t('settings.file_processing.feature.text_extraction.description')}>
        <ScenarioSection.Title />
        <ScenarioSection.Row>
          <ScenarioSection.Description />
          <Select
            value={defaultTextExtractionProcessor || '__none__'}
            onValueChange={(value) => setDefaultTextExtractionProcessor(value === '__none__' ? null : value)}>
            <SelectTrigger className="w-50 rounded-2xs">
              <SelectValue placeholder={t('settings.file_processing.no_default')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t('settings.file_processing.no_default')}</SelectItem>
              {availableImageProcessors.map((processor) => (
                <SelectItem key={processor.id} value={processor.id}>
                  {t(`settings.file_processing.processor.${processor.id}.name`)}
                  {processor.type === 'builtin' ? ` (${t('settings.file_processing.builtin')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ScenarioSection.Row>
      </ScenarioSection.Root>

      <div className="border-border border-b" />
    </div>
  )
}

export default GeneralSettings
