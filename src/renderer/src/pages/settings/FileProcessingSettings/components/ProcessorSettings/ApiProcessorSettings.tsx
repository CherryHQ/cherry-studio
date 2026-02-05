import {
  Button,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { FILE_PROCESSOR_MODELS, FILE_PROCESSOR_WEBSITE } from '@renderer/config/fileProcessing'
import { useFileProcessor } from '@renderer/hooks/useFileProcessing'
import type { FileProcessorFeature } from '@shared/data/presets/file-processing'
import { Eye, EyeOff } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProcessorSettingsLayout from '../ProcessorSettingsLayout'
import EditCapacityMetadataPopup from './EditCapacityMetadataPopup'

interface ApiProcessorSettingsProps {
  processorId: string
}

const ApiProcessorSettings: FC<ApiProcessorSettingsProps> = ({ processorId }) => {
  const { t } = useTranslation()
  const { processor, updateProcessor } = useFileProcessor(processorId)

  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiHostInputs, setApiHostInputs] = useState<Partial<Record<FileProcessorFeature, string>>>({})
  const [sharedApiHostInput, setSharedApiHostInput] = useState('')
  const [modelInputs, setModelInputs] = useState<Partial<Record<FileProcessorFeature, string>>>({})
  const [customModelFlags, setCustomModelFlags] = useState<Partial<Record<FileProcessorFeature, boolean>>>({})
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
  const [metadataDialogFeature, setMetadataDialogFeature] = useState<FileProcessorFeature | null>(null)

  const capabilities = useMemo(() => processor?.capabilities ?? [], [processor?.capabilities])
  const capabilityMap = useMemo(
    () => new Map(capabilities.map((capability) => [capability.feature, capability])),
    [capabilities]
  )
  const usesSharedApiHost = processor?.id === 'paddleocr'
  const modelOptions = useMemo(() => (processor ? (FILE_PROCESSOR_MODELS[processor.id] ?? []) : []), [processor])
  const supportsModel = modelOptions.length > 0

  const featureLabels = useMemo(
    () => ({
      text_extraction: t('settings.file_processing.feature.text_extraction.title'),
      markdown_conversion: t('settings.file_processing.feature.markdown_conversion.title')
    }),
    [t]
  )
  const metadataDialogCapability = useMemo(() => {
    if (!metadataDialogFeature) return null
    return capabilityMap.get(metadataDialogFeature) ?? null
  }, [capabilityMap, metadataDialogFeature])

  useEffect(() => {
    setApiKeyInput(processor?.apiKeys?.join(', ') || '')
    const nextApiHosts: Partial<Record<FileProcessorFeature, string>> = {}
    for (const capability of capabilities) {
      if ('apiHost' in capability) {
        nextApiHosts[capability.feature] = capability.apiHost || ''
      }
    }
    setApiHostInputs(nextApiHosts)
    if (usesSharedApiHost) {
      const firstHost = capabilities.find((capability) => 'apiHost' in capability)?.apiHost ?? ''
      setSharedApiHostInput(firstHost)
    }
    const nextModels: Partial<Record<FileProcessorFeature, string>> = {}
    const nextCustomFlags: Partial<Record<FileProcessorFeature, boolean>> = {}
    for (const capability of capabilities) {
      const currentModel = capability.modelId ?? ''
      nextModels[capability.feature] = currentModel
      nextCustomFlags[capability.feature] = currentModel !== '' && !modelOptions.includes(currentModel)
    }
    setModelInputs(nextModels)
    setCustomModelFlags(nextCustomFlags)
  }, [processor, capabilities, usesSharedApiHost, modelOptions])

  if (!processor) return null

  const handleApiKeysBlur = (value: string) => {
    const newKeys = value
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
    const currentKeys = processor.apiKeys ?? []
    if (JSON.stringify(newKeys) !== JSON.stringify(currentKeys)) {
      updateProcessor({ apiKeys: newKeys })
    }
  }

  const handleApiHostBlur = (feature: FileProcessorFeature, value: string) => {
    const capability = capabilityMap.get(feature)
    if (!capability || !('apiHost' in capability)) return

    const trimmed = value.trim().replace(/\/$/, '')
    if (trimmed !== (capability.apiHost ?? '')) {
      updateProcessor({ capabilities: { [feature]: { apiHost: trimmed } } })
    }
    setApiHostInputs((prev) => ({ ...prev, [feature]: trimmed }))
  }

  const handleSharedApiHostBlur = (value: string) => {
    const trimmed = value.trim().replace(/\/$/, '')
    const updates: Partial<Record<FileProcessorFeature, { apiHost: string }>> = {}
    for (const capability of capabilities) {
      if ('apiHost' in capability) {
        updates[capability.feature] = { apiHost: trimmed }
      }
    }
    if (Object.keys(updates).length > 0) {
      updateProcessor({ capabilities: updates })
    }
    setSharedApiHostInput(trimmed)
  }

  const handleModelSelectChange = (feature: FileProcessorFeature, value: string) => {
    if (value === '__custom__') {
      setCustomModelFlags((prev) => ({ ...prev, [feature]: true }))
      return
    }
    setCustomModelFlags((prev) => ({ ...prev, [feature]: false }))
    setModelInputs((prev) => ({ ...prev, [feature]: value }))
    updateProcessor({ capabilities: { [feature]: { modelId: value } } })
  }

  const handleCustomModelBlur = (feature: FileProcessorFeature, value: string) => {
    const trimmed = value.trim()
    setModelInputs((prev) => ({ ...prev, [feature]: trimmed }))
    setCustomModelFlags((prev) => ({ ...prev, [feature]: true }))
    updateProcessor({ capabilities: { [feature]: { modelId: trimmed } } })
  }

  const handleEditCapacityMetadata = (feature: FileProcessorFeature) => {
    setMetadataDialogFeature(feature)
    setMetadataDialogOpen(true)
  }

  const handleMetadataOpenChange = (nextOpen: boolean) => {
    setMetadataDialogOpen(nextOpen)
    if (!nextOpen) {
      setMetadataDialogFeature(null)
    }
  }

  const handleMetadataSave = (metadata: Record<string, unknown>) => {
    if (!metadataDialogFeature) return
    updateProcessor({ capabilities: { [metadataDialogFeature]: { metadata } } })
  }

  const renderApiKeyField = () => (
    <Field>
      <FieldLabel>{t('settings.file_processing.api_key')}</FieldLabel>
      <FieldContent>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onBlur={(e) => handleApiKeysBlur(e.target.value)}
              placeholder={t('settings.file_processing.api_key_placeholder')}
              className="rounded-2xs pr-10"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="-translate-y-1/2 absolute top-1/2 right-2"
              onClick={() => setShowApiKey((prev) => !prev)}>
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
        </div>
        {FILE_PROCESSOR_WEBSITE[processor.id]?.websites.apiKey && (
          <span
            className="mt-1 flex cursor-pointer items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => window.open(FILE_PROCESSOR_WEBSITE[processor.id]?.websites.apiKey, '_blank')}>
            {t('settings.file_processing.get_api_key')}
          </span>
        )}
      </FieldContent>
    </Field>
  )

  const renderFeatureSection = (capability: (typeof capabilities)[number], isFirst: boolean, showApiHost: boolean) => {
    const hasApiHost = showApiHost && 'apiHost' in capability
    const featureLabel = featureLabels[capability.feature]
    const modelValue = modelInputs[capability.feature] ?? capability.modelId ?? ''
    const isCustomModel = customModelFlags[capability.feature] ?? false
    const selectValue = isCustomModel ? '__custom__' : modelValue
    const hasModelField = supportsModel
    const hasMetadataField = true

    if (!hasApiHost && !hasModelField && !hasMetadataField) {
      return null
    }

    return (
      <>
        {capabilities.length > 1 && (
          <div
            className={isFirst ? 'px-4 pt-2 text-muted-foreground text-xs' : 'px-4 pt-3 text-muted-foreground text-xs'}>
            {featureLabel}
          </div>
        )}
        <FieldGroup className="px-4 py-2">
          {hasApiHost && (
            <Field>
              <FieldLabel>{t('settings.file_processing.api_host')}</FieldLabel>
              <FieldContent>
                <Input
                  value={apiHostInputs[capability.feature] ?? ''}
                  onChange={(e) =>
                    setApiHostInputs((prev) => ({
                      ...prev,
                      [capability.feature]: e.target.value
                    }))
                  }
                  onBlur={(e) => handleApiHostBlur(capability.feature, e.target.value)}
                  placeholder={t('settings.file_processing.api_host_placeholder')}
                  className="rounded-2xs"
                />
              </FieldContent>
            </Field>
          )}
          {hasModelField && (
            <Field className="flex items-center gap-3">
              <div className="flex w-full items-center gap-3">
                <FieldLabel className="w-24 shrink-0">{t('common.model')}</FieldLabel>
                <FieldContent className="flex-1">
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectValue}
                      onValueChange={(value) => handleModelSelectChange(capability.feature, value)}>
                      <SelectTrigger className="w-56 rounded-2xs">
                        <SelectValue placeholder={t('common.select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">{t('settings.file_processing.custom')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustomModel && (
                      <Input
                        value={modelInputs[capability.feature] ?? ''}
                        onChange={(e) =>
                          setModelInputs((prev) => ({
                            ...prev,
                            [capability.feature]: e.target.value
                          }))
                        }
                        onBlur={(e) => handleCustomModelBlur(capability.feature, e.target.value)}
                        placeholder={t('common.model')}
                        className="flex-1 rounded-2xs"
                      />
                    )}
                  </div>
                </FieldContent>
              </div>
            </Field>
          )}
          {hasMetadataField && (
            <Field className="flex items-center gap-3">
              <div className="flex w-full items-center gap-3">
                <FieldLabel className="w-24 shrink-0">{t('settings.file_processing.metadata')}</FieldLabel>
                <FieldContent>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-56 rounded-3xs px-2 text-xs"
                    onClick={() => handleEditCapacityMetadata(capability.feature)}>
                    {t('common.edit')}
                  </Button>
                </FieldContent>
              </div>
            </Field>
          )}
        </FieldGroup>
      </>
    )
  }

  const renderSharedApiHostField = () => (
    <FieldGroup className="px-4 py-2">
      <Field>
        <FieldLabel>{t('settings.file_processing.api_host')}</FieldLabel>
        <FieldContent>
          <Input
            value={sharedApiHostInput}
            onChange={(e) => setSharedApiHostInput(e.target.value)}
            onBlur={(e) => handleSharedApiHostBlur(e.target.value)}
            placeholder={t('settings.file_processing.api_host_placeholder')}
            className="rounded-2xs"
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )

  return (
    <ProcessorSettingsLayout.Root
      title={t(`settings.file_processing.processor.${processor.id}.name`)}
      officialUrl={FILE_PROCESSOR_WEBSITE[processor.id]?.websites.official}>
      <ProcessorSettingsLayout.Header />
      <ProcessorSettingsLayout.Content>
        <FieldGroup className="px-4 py-2">{renderApiKeyField()}</FieldGroup>
        <div className="border-border border-b" />
        {usesSharedApiHost && (
          <>
            {renderSharedApiHostField()}
            <div className="border-border border-b" />
          </>
        )}
        {capabilities.map((capability, index) => (
          <div key={capability.feature} className="flex flex-col gap-2">
            {renderFeatureSection(capability, index === 0, !usesSharedApiHost)}
            {index < capabilities.length - 1 && <div className="border-border border-b" />}
          </div>
        ))}
      </ProcessorSettingsLayout.Content>
      {metadataDialogFeature && (
        <EditCapacityMetadataPopup.View
          open={metadataDialogOpen}
          onOpenChange={handleMetadataOpenChange}
          metadata={metadataDialogCapability?.metadata ?? {}}
          onSave={handleMetadataSave}
        />
      )}
    </ProcessorSettingsLayout.Root>
  )
}

export default ApiProcessorSettings
