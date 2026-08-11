import {
  Button,
  type ComboboxOption,
  InfoTooltip,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { FileProcessorIcon } from '@renderer/components/icons/FileProcessorIcon'
import {
  SettingGroup,
  SettingHelpLink,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useLanguages } from '@renderer/hooks/translate'
import { toast } from '@renderer/services/toast'
import { formatApiKeys, joinApiKeyString, splitApiKeyString, validateApiHost } from '@renderer/utils/api'
import { cn } from '@renderer/utils/style'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_LOCAL_MODEL } from '@shared/data/presets/fileProcessing'
import { List, SquareCheckBig } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type FileProcessingMenuEntry,
  getProcessorApiKeyWebsite,
  getProcessorDescriptionKey,
  getProcessorNameKey,
  getTesseractLanguageCode,
  shouldShowLanguageOptions,
  supportsApiSettings,
  supportsLanguageConfig
} from '../utils/fileProcessingMeta'
import { FileProcessingApiKeyListPopup } from './FileProcessingApiKeyList'
import { LocalModelRequirement } from './LocalModelRequirement'
import { PaddleOcrDeploymentInfo } from './PaddleOcrDeploymentInfo'
import { PaddleOcrModelSettings } from './PaddleOcrModelSettings'
import { TesseractLanguagePacks } from './TesseractLanguagePacks'

const logger = loggerService.withContext('ProcessorPanel')

type ProcessorPanelProps = {
  entry: FileProcessingMenuEntry
  entries: FileProcessingMenuEntry[]
  selectionDisabled?: boolean
  onSelectEntry: (entry: FileProcessingMenuEntry) => void
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
  entry,
  entries,
  selectionDisabled = false,
  onSelectEntry,
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
  const featureTitleKey =
    entry.feature === 'image_to_text'
      ? 'settings.tool.file_processing.features.image_to_text.title'
      : 'settings.tool.file_processing.features.document_to_markdown.title'
  const featureTooltipKey =
    entry.feature === 'image_to_text'
      ? 'settings.tool.file_processing.features.image_to_text.tooltip'
      : 'settings.tool.file_processing.features.document_to_markdown.tooltip'
  const featureTitle = t(featureTitleKey)
  const showApiSettings = supportsApiSettings(processor)
  const showLanguageOptions = shouldShowLanguageOptions(processor.id)
  const requiredLocalModel = FILE_PROCESSOR_LOCAL_MODEL[processor.id]
  const hasProcessorDetails =
    showApiSettings ||
    processor.id === 'paddleocr' ||
    processor.id === 'system' ||
    Boolean(requiredLocalModel) ||
    showLanguageOptions

  const [apiKeysInput, setApiKeysInput] = useState(() => joinApiKeyString(processor.apiKeys ?? []))
  const [apiHostInput, setApiHostInput] = useState(entry.capability.apiHost ?? '')
  const [modelIdInput, setModelIdInput] = useState(entry.capability.modelId ?? '')
  const pendingDefaultKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setApiKeysInput(joinApiKeyString(processor.apiKeys ?? []))
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
        return true
      } catch (error) {
        logger.error(`Failed to ${actionName}`, error as Error)
        toast.error(t('settings.tool.file_processing.errors.save_failed'))
        return false
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
      onSetApiKeys: async (processorId, apiKeys) => {
        await onSetApiKeys(processorId, apiKeys)
        setApiKeysInput(joinApiKeyString(apiKeys))
      },
      title: `${processorName} ${t('settings.provider.api.key.list.title')}`
    })
  }, [apiKeysInput, onSetApiKeys, processor.id, processorName, t])

  const handleApiHostBlur = useCallback(async () => {
    const trimmedApiHost = apiHostInput.trim()
    setApiHostInput(trimmedApiHost)
    if (!validateApiHost(trimmedApiHost)) {
      toast.warning(t('settings.tool.file_processing.errors.invalid_api_host'))
      return
    }
    await persist(() => onSetCapabilityField(processor.id, entry.feature, 'apiHost', trimmedApiHost), 'save API host')
  }, [apiHostInput, entry.feature, onSetCapabilityField, persist, processor.id, t])

  const setModelIdInputAndPersist = useCallback(
    async (value: string) => {
      setModelIdInput(value)
      await persist(() => onSetCapabilityField(processor.id, entry.feature, 'modelId', value), 'save model id')
    },
    [entry.feature, onSetCapabilityField, persist, processor.id]
  )

  const commitPendingDefault = useCallback(
    async (selectedEntry: FileProcessingMenuEntry) => {
      if (pendingDefaultKeyRef.current !== selectedEntry.key) {
        return
      }

      const saved = await persist(
        () => onSetDefaultProcessor(selectedEntry.feature, selectedEntry.processor.id),
        'set default processor'
      )
      if (saved && pendingDefaultKeyRef.current === selectedEntry.key) {
        pendingDefaultKeyRef.current = null
      }
    },
    [onSetDefaultProcessor, persist]
  )

  const handleProcessorChange = useCallback(
    (processorId: string) => {
      const selectedEntry = entries.find((item) => item.processor.id === processorId)

      if (!selectedEntry || selectedEntry.key === entry.key) {
        return
      }

      const selectedModel = FILE_PROCESSOR_LOCAL_MODEL[selectedEntry.processor.id]
      pendingDefaultKeyRef.current = selectedModel ? selectedEntry.key : null
      onSelectEntry(selectedEntry)

      if (selectedModel) {
        return
      }

      void persist(
        () => onSetDefaultProcessor(selectedEntry.feature, selectedEntry.processor.id),
        'set default processor'
      ).then((saved) => {
        if (!saved) {
          onSelectEntry(entry)
        }
      })
    },
    [entries, entry, onSelectEntry, onSetDefaultProcessor, persist]
  )

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
    <SettingGroup className="flex w-full flex-col gap-2">
      <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-3', hasProcessorDetails && 'mb-2')}>
        <SettingTitle className="h-8 min-w-0 justify-start gap-1.5">
          <span className="truncate">{featureTitle}</span>
          <InfoTooltip
            content={t(featureTooltipKey)}
            placement="right"
            iconProps={{ size: 13, color: 'currentColor', className: 'shrink-0 opacity-80' }}
          />
        </SettingTitle>
        <Select value={processor.id} disabled={selectionDisabled} onValueChange={handleProcessorChange}>
          <SelectTrigger size="sm" className="h-8 w-56 text-sm" aria-label={featureTitle}>
            <SelectValue placeholder={t('common.select')} />
          </SelectTrigger>
          <SelectContent>
            {entries.map((item) => (
              <SelectItem key={item.key} value={item.processor.id}>
                <div className="flex items-center gap-2">
                  <FileProcessorIcon processorId={item.processor.id} />
                  <span>{t(getProcessorNameKey(item.processor.id))}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showApiSettings ? (
        <div className="flex flex-col gap-3 border-border-subtle border-t pt-4">
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <SettingRowTitle className="font-medium">
                {t('settings.tool.file_processing.fields.api_key')}
              </SettingRowTitle>
              {apiKeyWebsite ? (
                <SettingHelpLink className="text-xs leading-5" target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </SettingHelpLink>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                type="password"
                value={apiKeysInput}
                onChange={(event) => setApiKeysInput(event.target.value)}
                onBlur={() => void handleApiKeysBlur()}
                placeholder={t('settings.tool.file_processing.fields.api_keys_placeholder')}
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-8 shrink-0 text-muted-foreground shadow-none hover:text-foreground"
                  aria-label={t('settings.provider.api.key.list.open')}
                  onClick={() => void openApiKeyList()}>
                  <List size={14} />
                </Button>
              </Tooltip>
            </div>
          </div>
          {entry.capability.apiHost !== undefined ? (
            <div className="flex flex-col gap-2 border-border-subtle border-t pt-3">
              <SettingRowTitle className="font-medium">
                {t('settings.tool.file_processing.fields.api_base_url')}
              </SettingRowTitle>
              <Input
                value={apiHostInput}
                onChange={(event) => setApiHostInput(event.target.value)}
                onBlur={() => void handleApiHostBlur()}
                placeholder={t('settings.provider.api_host')}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {processor.id === 'paddleocr' && entry.capability.modelId !== undefined ? (
        <PaddleOcrModelSettings
          feature={entry.capability.feature}
          value={modelIdInput}
          onChange={(value) => void setModelIdInputAndPersist(value)}
        />
      ) : null}

      {processor.id === 'paddleocr' ? <PaddleOcrDeploymentInfo /> : null}

      {requiredLocalModel ? (
        <LocalModelRequirement
          model={requiredLocalModel}
          description={t(getProcessorDescriptionKey(processor.id))}
          onReady={() => commitPendingDefault(entry)}
        />
      ) : null}

      {processor.id === 'system' ? (
        <div className="flex flex-col gap-3 border-border-subtle border-t pt-4">
          <SettingRow className="items-start justify-start gap-2 py-1">
            <SquareCheckBig size={13} className="mt-0.5 shrink-0 text-success" />
            <div>
              <SettingRowTitle className="text-success text-xs">
                {t('settings.tool.file_processing.processors.system.status.available')}
              </SettingRowTitle>
              <SettingHelpText className="mt-1 text-xs">
                {t('settings.tool.file_processing.processors.system.status.no_configuration')}
              </SettingHelpText>
            </div>
          </SettingRow>
        </div>
      ) : null}

      {showLanguageOptions ? (
        <TesseractLanguagePacks
          options={languageOptions}
          selectedLanguages={selectedLanguages}
          onChange={(value) => void handleLanguagesChange(value)}
        />
      ) : null}
    </SettingGroup>
  )
}
