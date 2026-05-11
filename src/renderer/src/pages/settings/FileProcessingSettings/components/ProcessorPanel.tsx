import { Badge, Button, type ComboboxOption, Input, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useLanguages } from '@renderer/hooks/translate'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { List, SquareCheckBig } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingRow,
  SettingRowTitle,
  SettingSubtitle,
  SettingTitle
} from '../..'
import {
  type FileProcessingMenuEntry,
  getProcessorApiKeyWebsite,
  getProcessorNameKey,
  getTesseractLanguageCode,
  shouldShowLanguageOptions,
  supportsApiSettings,
  supportsLanguageConfig
} from '../utils/fileProcessingMeta'
import { FileProcessingApiKeyListPopup } from './FileProcessingApiKeyList'
import { PaddleOCRDeploymentInfo } from './PaddleOCRDeploymentInfo'
import { PaddleOCRModelSettings } from './PaddleOCRModelSettings'
import { ProcessorAvatar } from './ProcessorAvatar'
import { TesseractLanguagePacks } from './TesseractLanguagePacks'

const logger = loggerService.withContext('ProcessorPanel')

type ProcessorPanelProps = {
  entry: FileProcessingMenuEntry
  defaultDocumentProcessor: FileProcessorId | null
  defaultImageProcessor: FileProcessorId | null
  onSetApiKeys: (processorId: FileProcessorId, apiKeys: string[]) => Promise<void>
  onSetCapabilityField: (
    processorId: FileProcessorId,
    feature: FileProcessorFeature,
    field: 'apiHost' | 'modelId',
    value: string
  ) => Promise<void>
  onSetDefaultProcessor: (feature: FileProcessorFeature, processorId: FileProcessorId) => Promise<void>
  onSetLanguageOptions: (
    processorId: Extract<FileProcessorId, 'system' | 'tesseract'>,
    langs: string[]
  ) => Promise<void>
}

export function ProcessorPanel({
  defaultDocumentProcessor,
  defaultImageProcessor,
  entry,
  onSetApiKeys,
  onSetCapabilityField,
  onSetDefaultProcessor,
  onSetLanguageOptions
}: ProcessorPanelProps) {
  const { t } = useTranslation()
  const { languages } = useLanguages()
  const processor = entry.processor
  const processorName = t(getProcessorNameKey(processor.id))
  const apiKeyWebsite = getProcessorApiKeyWebsite(processor.id)
  const isDefault =
    entry.feature === 'image_to_text'
      ? defaultImageProcessor === processor.id
      : defaultDocumentProcessor === processor.id

  const [apiKeysInput, setApiKeysInput] = useState(() => processor.apiKeys?.join(', ') ?? '')
  const [apiHostInput, setApiHostInput] = useState(entry.capability.apiHost ?? '')
  const [modelIdInput, setModelIdInput] = useState(entry.capability.modelId ?? '')

  useEffect(() => {
    setApiKeysInput(processor.apiKeys?.join(', ') ?? '')
    setApiHostInput(entry.capability.apiHost ?? '')
    setModelIdInput(entry.capability.modelId ?? '')
  }, [entry.key])

  const languageOptions = useMemo(() => {
    if (!languages) {
      return []
    }

    if (processor.id === 'tesseract') {
      return languages
        .map((language) => {
          const tesseractCode = getTesseractLanguageCode(language.langCode)

          if (!tesseractCode) {
            return null
          }

          return {
            value: tesseractCode,
            label: language.value
          }
        })
        .filter((option): option is ComboboxOption => Boolean(option))
    }

    return languages.map((language) => ({
      value: language.langCode,
      label: `${language.emoji} ${language.value}`
    }))
  }, [languages, processor.id])

  const selectedLanguages = processor.options?.langs ?? []

  const persist = useCallback(
    async (action: () => Promise<void>, actionName: string) => {
      try {
        await action()
      } catch (error) {
        logger.error(`Failed to ${actionName}`, error as Error)
        window.toast.error(t('settings.tool.file_processing.errors.save_failed'))
      }
    },
    [t]
  )

  const handleApiKeysBlur = useCallback(async () => {
    await persist(() => onSetApiKeys(processor.id, splitApiKeyString(formatApiKeys(apiKeysInput))), 'save API keys')
  }, [apiKeysInput, onSetApiKeys, persist, processor.id])

  const openApiKeyList = useCallback(async () => {
    await FileProcessingApiKeyListPopup.show({
      processorId: processor.id,
      apiKeys: splitApiKeyString(formatApiKeys(apiKeysInput)),
      onSetApiKeys,
      title: `${processorName} ${t('settings.provider.api.key.list.title')}`
    })
  }, [apiKeysInput, onSetApiKeys, processor.id, processorName, t])

  const handleApiHostBlur = useCallback(async () => {
    await persist(() => onSetCapabilityField(processor.id, entry.feature, 'apiHost', apiHostInput), 'save API host')
  }, [apiHostInput, entry.feature, onSetCapabilityField, persist, processor.id])

  const setModelIdInputAndPersist = useCallback(
    async (value: string) => {
      setModelIdInput(value)
      await persist(() => onSetCapabilityField(processor.id, entry.feature, 'modelId', value), 'save model id')
    },
    [entry.feature, onSetCapabilityField, persist, processor.id]
  )

  const handleSetDefault = useCallback(async () => {
    if (!isDefault) {
      await persist(() => onSetDefaultProcessor(entry.feature, processor.id), 'set default processor')
    }
  }, [entry.feature, isDefault, onSetDefaultProcessor, persist, processor.id])

  const handleLanguagesChange = useCallback(
    async (value: string | string[]) => {
      const processorId = processor.id

      if (!supportsLanguageConfig(processorId)) {
        return
      }

      const langs = Array.isArray(value) ? value : []
      await persist(() => onSetLanguageOptions(processorId, langs), 'save language options')
    },
    [onSetLanguageOptions, persist, processor.id]
  )

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <ProcessorAvatar processorId={processor.id} />
          <div className="min-w-0">
            <SettingTitle className="justify-start truncate">{processorName}</SettingTitle>
          </div>
        </div>
        {isDefault ? (
          <Badge className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400">
            {t('common.default')}
          </Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void handleSetDefault()}>
            {t('settings.tool.file_processing.actions.set_as_default')}
          </Button>
        )}
      </div>

      <SettingDivider />

      {supportsApiSettings(processor) ? (
        <>
          <SettingSubtitle>{t('settings.tool.file_processing.sections.authentication')}</SettingSubtitle>
          <SettingRow className="items-start gap-4 py-1">
            <SettingRowTitle className="w-37.5 shrink-0 pt-2">
              {t('settings.tool.file_processing.fields.api_key')}
            </SettingRowTitle>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  type="password"
                  value={apiKeysInput}
                  onChange={(event) => setApiKeysInput(event.target.value)}
                  onBlur={() => void handleApiKeysBlur()}
                  placeholder={t('settings.tool.file_processing.fields.api_keys_placeholder')}
                  spellCheck={false}
                />
                <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={t('settings.provider.api.key.list.open')}
                    onClick={() => void openApiKeyList()}>
                    <List size={13} />
                  </Button>
                </Tooltip>
              </div>
              {apiKeyWebsite ? (
                <SettingHelpTextRow className="justify-between">
                  <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                    {t('settings.provider.get_api_key')}
                  </SettingHelpLink>
                  <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
                </SettingHelpTextRow>
              ) : null}
            </div>
          </SettingRow>
          {entry.capability.apiHost !== undefined ? (
            <>
              <SettingDivider />
              <SettingRow className="items-start gap-4 py-1">
                <SettingRowTitle className="w-37.5 shrink-0 pt-2">
                  {t('settings.tool.file_processing.fields.api_base_url')}
                </SettingRowTitle>
                <Input
                  value={apiHostInput}
                  onChange={(event) => setApiHostInput(event.target.value)}
                  onBlur={() => void handleApiHostBlur()}
                  placeholder={t('settings.provider.api_host')}
                />
              </SettingRow>
            </>
          ) : null}
        </>
      ) : null}

      {processor.id === 'paddleocr' && entry.capability.modelId !== undefined ? (
        <PaddleOCRModelSettings value={modelIdInput} onChange={(value) => void setModelIdInputAndPersist(value)} />
      ) : null}

      {processor.id === 'paddleocr' ? <PaddleOCRDeploymentInfo /> : null}

      {processor.id === 'system' ? (
        <>
          <SettingSubtitle>{t('settings.tool.file_processing.sections.status')}</SettingSubtitle>
          <SettingRow className="items-start justify-start gap-2 py-1">
            <SquareCheckBig size={13} className="mt-0.5 shrink-0 text-emerald-500" />
            <div>
              <SettingRowTitle className="font-medium text-emerald-600 text-xs dark:text-emerald-400">
                {t('settings.tool.file_processing.processors.system.status.available')}
              </SettingRowTitle>
              <SettingHelpText className="mt-1 text-xs">
                {t('settings.tool.file_processing.processors.system.status.no_configuration')}
              </SettingHelpText>
            </div>
          </SettingRow>
        </>
      ) : null}

      {shouldShowLanguageOptions(processor.id) ? (
        <TesseractLanguagePacks
          options={languageOptions}
          selectedLanguages={selectedLanguages}
          onChange={(value) => void handleLanguagesChange(value)}
        />
      ) : null}
    </div>
  )
}
