import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useDefaultProcessors, useFileProcessors } from '@renderer/hooks/useFileProcessors'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

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
      <div className="flex flex-col gap-2 px-4 py-2">
        <div className="font-medium text-sm">{t('settings.file_processing.scenario.knowledge_base.title')}</div>
        <p className="mb-2 text-muted-foreground text-xs">
          {t('settings.file_processing.scenario.knowledge_base.description')}
        </p>
        <div className="border-border border-b" />

        <div className="mt-2 flex flex-row items-center justify-between">
          <div className="text-sm">{t('settings.file_processing.default_service')}</div>
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
        </div>
      </div>

      <div className="border-border border-b" />

      {/* Chat Image Understanding */}
      <div className="flex flex-col gap-2 px-4 py-2">
        <div className="font-medium text-sm">{t('settings.file_processing.scenario.chat_image.title')}</div>
        <p className="mb-2 text-muted-foreground text-xs">
          {t('settings.file_processing.scenario.chat_image.description')}
        </p>
        <div className="border-border border-b" />

        <div className="mt-2 flex flex-row items-center justify-between">
          <div className="text-sm">{t('settings.file_processing.default_service')}</div>
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
        </div>
      </div>

      <div className="border-border border-b" />
    </div>
  )
}

export default GeneralSettings
