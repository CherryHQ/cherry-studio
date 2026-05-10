import { Badge, Button, type ComboboxOption, Tooltip } from '@cherrystudio/ui'
import useTranslate from '@renderer/hooks/useTranslate'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { splitApiKeyString } from '@shared/utils/api'
import { List, SquareCheckBig } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type FileProcessingMenuEntry,
  getProcessorApiKeyWebsite,
  getProcessorDescriptionKey,
  getProcessorNameKey,
  getTesseractLanguageCode,
  supportsApiSettings,
  supportsLanguageOptions
} from '../utils/fileProcessingMeta'
import { getProcessorLanguageOptions } from '../utils/fileProcessingPreferences'
import { PasswordField, TextField } from './Field'
import { FileProcessingApiKeyListPopup } from './FileProcessingApiKeyList'
import { PaddleOCRDeploymentInfo } from './PaddleOCRDeploymentInfo'
import { PaddleOCRModelSettings } from './PaddleOCRModelSettings'
import { ProcessorAvatar } from './ProcessorAvatar'
import { SettingsSection } from './SettingsSection'
import { TesseractLanguagePacks } from './TesseractLanguagePacks'

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
  const { translateLanguages } = useTranslate()
  const processor = entry.processor
  const processorName = t(getProcessorNameKey(processor.id))
  const apiKeyWebsite = getProcessorApiKeyWebsite(processor.id)
  const processorDescription = t(getProcessorDescriptionKey(processor.id))
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
  }, [entry.capability.apiHost, entry.capability.modelId, processor.apiKeys])

  const languageOptions = useMemo(() => {
    if (processor.id === 'tesseract') {
      return translateLanguages
        .map((language) => {
          const tesseractCode = getTesseractLanguageCode(language.langCode)

          if (!tesseractCode) {
            return null
          }

          return {
            value: tesseractCode,
            label: language.label()
          }
        })
        .filter((option): option is ComboboxOption => Boolean(option))
    }

    return translateLanguages.map((language) => ({
      value: language.langCode,
      label: `${language.emoji} ${language.label()}`
    }))
  }, [processor.id, translateLanguages])

  const selectedLanguages = useMemo(() => getProcessorLanguageOptions(processor.options), [processor.options])

  const handleApiKeysBlur = useCallback(() => {
    void onSetApiKeys(processor.id, splitApiKeyString(apiKeysInput))
  }, [apiKeysInput, onSetApiKeys, processor.id])

  const openApiKeyList = useCallback(async () => {
    await FileProcessingApiKeyListPopup.show({
      processorId: processor.id,
      apiKeys: splitApiKeyString(apiKeysInput),
      onSetApiKeys,
      title: `${processorName} ${t('settings.provider.api.key.list.title')}`
    })
  }, [apiKeysInput, onSetApiKeys, processor.id, processorName, t])

  const handleApiHostBlur = useCallback(() => {
    void onSetCapabilityField(processor.id, entry.feature, 'apiHost', apiHostInput)
  }, [apiHostInput, entry.feature, onSetCapabilityField, processor.id])

  const setModelIdInputAndPersist = useCallback(
    (value: string) => {
      setModelIdInput(value)
      void onSetCapabilityField(processor.id, entry.feature, 'modelId', value)
    },
    [entry.feature, onSetCapabilityField, processor.id]
  )

  const handleSetDefault = useCallback(() => {
    if (!isDefault) {
      void onSetDefaultProcessor(entry.feature, processor.id)
    }
  }, [entry.feature, isDefault, onSetDefaultProcessor, processor.id])

  const handleLanguagesChange = useCallback(
    (value: string | string[]) => {
      if (!supportsLanguageOptions(processor.id)) {
        return
      }

      const langs = Array.isArray(value) ? value : []
      void onSetLanguageOptions(processor.id, langs)
    },
    [onSetLanguageOptions, processor.id]
  )

  return (
    <div className="flex min-h-full flex-col gap-4 px-6 py-5">
      <div className="mb-1 flex items-center gap-3">
        <ProcessorAvatar processorId={processor.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-foreground/90 text-sm">{processorName}</h3>
          <p className="mt-0.5 text-foreground/35 text-xs leading-tight">{processorDescription}</p>
        </div>
        {isDefault ? (
          <Badge className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400">
            {t('common.default')}
          </Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={handleSetDefault}>
            {t('settings.tool.file_processing.actions.set_as_default')}
          </Button>
        )}
      </div>

      {supportsApiSettings(processor) ? (
        <SettingsSection title={t('settings.tool.file_processing.sections.authentication')}>
          <PasswordField
            label={t('settings.tool.file_processing.fields.api_key')}
            value={apiKeysInput}
            onChange={setApiKeysInput}
            onBlur={handleApiKeysBlur}
            placeholder={t('settings.tool.file_processing.fields.api_keys_placeholder')}
            labelAction={
              <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 shrink-0 text-foreground/40 shadow-none hover:text-foreground/70"
                  aria-label={t('settings.provider.api.key.list.open')}
                  onClick={() => void openApiKeyList()}>
                  <List size={13} />
                </Button>
              </Tooltip>
            }
          />
          {apiKeyWebsite ? (
            <div className="-mt-1">
              <a
                href={apiKeyWebsite}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-primary/70 text-sm leading-tight transition-colors hover:text-primary">
                {t('settings.provider.get_api_key')}
              </a>
            </div>
          ) : null}
          {entry.capability.apiHost !== undefined ? (
            <TextField
              label={t('settings.tool.file_processing.fields.api_base_url')}
              value={apiHostInput}
              onChange={setApiHostInput}
              onBlur={handleApiHostBlur}
              placeholder={t('settings.provider.api_host')}
            />
          ) : null}
        </SettingsSection>
      ) : null}

      {processor.id === 'paddleocr' && entry.capability.modelId !== undefined ? (
        <PaddleOCRModelSettings value={modelIdInput} onChange={setModelIdInputAndPersist} />
      ) : null}

      {processor.id === 'paddleocr' ? <PaddleOCRDeploymentInfo /> : null}

      {processor.id === 'system' ? (
        <SettingsSection title={t('settings.tool.file_processing.sections.status')}>
          <div className="flex items-start gap-2">
            <SquareCheckBig size={13} className="mt-0.5 shrink-0 text-emerald-500" />
            <div>
              <p className="font-medium text-emerald-600 text-xs leading-tight dark:text-emerald-400">
                {t('settings.tool.file_processing.processors.system.status.available')}
              </p>
              <p className="mt-1 text-foreground/35 text-xs leading-tight">
                {t('settings.tool.file_processing.processors.system.status.no_configuration')}
              </p>
            </div>
          </div>
        </SettingsSection>
      ) : null}

      {supportsLanguageOptions(processor.id) ? (
        <TesseractLanguagePacks
          options={languageOptions}
          selectedLanguages={selectedLanguages}
          onChange={handleLanguagesChange}
        />
      ) : null}
    </div>
  )
}
