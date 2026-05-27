import { InfoTooltip, Tooltip } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { TokenFluxPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Select } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { DynamicFormRender } from './components/DynamicFormRender'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingImageNavigation } from './hooks/usePaintingImageNavigation'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { DEFAULT_TOKENFLUX_PAINTING, type TokenFluxModel } from './providers/tokenflux/config'
import TokenFluxService from './providers/tokenflux/service'
import { checkProviderEnabled } from './utils'

const logger = loggerService.withContext('TokenFluxPage')

const TokenFluxPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [models, setModels] = useState<TokenFluxModel[]>([])
  const [selectedModel, setSelectedModel] = useState<TokenFluxModel | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})

  const { t, i18n } = useTranslation()
  const providers = useAllProviders()
  const { addPainting, removePainting, updatePainting, tokenflux_paintings } = usePaintings()
  const tokenFluxPaintings = tokenflux_paintings
  const [painting, setPainting] = useState<TokenFluxPainting>(
    tokenFluxPaintings[0] || { ...DEFAULT_TOKENFLUX_PAINTING, id: uuid() }
  )
  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(painting.files.length)

  const navigate = useNavigate()
  const location = useLocation()
  const tokenfluxProvider = providers.find((p) => p.id === 'tokenflux')!
  const textareaRef = useRef<any>(null)
  const tokenFluxService = useMemo(
    () => new TokenFluxService(tokenfluxProvider.apiHost, tokenfluxProvider.apiKey),
    [tokenfluxProvider]
  )

  useEffect(() => {
    void tokenFluxService.fetchModels().then((models) => {
      setModels(models)
      if (models.length > 0) {
        setSelectedModel(models[0])
      }
    })
  }, [tokenFluxService])

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_TOKENFLUX_PAINTING,
      id: uuid(),
      model: selectedModel?.id || '',
      inputParams: {},
      generationId: undefined
    }
  }, [selectedModel])

  const updatePaintingState = useCallback(
    (updates: Partial<TokenFluxPainting>) => {
      setPainting((prevPainting) => {
        const updatedPainting = { ...prevPainting, ...updates }
        updatePainting('tokenflux_paintings', updatedPainting)
        return updatedPainting
      })
    },
    [updatePainting]
  )

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') {
      window.modal.error({
        content: getErrorMessage(error),
        centered: true
      })
    }
  }
  const { isLoading, generating, runGeneration, cancelGeneration } = usePaintingGenerationTask({
    onError: handleError
  })

  const handleModelChange = (modelId: string) => {
    const model = models.find((m) => m.id === modelId)
    if (model) {
      setSelectedModel(model)
      setFormData({})
      updatePaintingState({ model: model.id, inputParams: {} })
    }
  }

  const handleFormFieldChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value }
    setFormData(newFormData)
    updatePaintingState({ inputParams: newFormData })
  }

  const onGenerate = async () => {
    await checkProviderEnabled(tokenfluxProvider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''

    if (!selectedModel || !prompt) {
      window.modal.error({
        content: t('paintings.text_desc_required'),
        centered: true
      })
      return
    }

    await runGeneration(async (signal) => {
      const requestBody = {
        model: selectedModel.id,
        input: {
          prompt,
          ...formData
        }
      }

      const inputParams = { prompt, ...formData }
      updatePaintingState({
        model: selectedModel.id,
        prompt,
        status: 'processing',
        inputParams
      })

      const result = await tokenFluxService.generateAndWait(requestBody, {
        signal,
        onStatusUpdate: (updates) => {
          updatePaintingState(updates)
        }
      })

      if (result && result.images && result.images.length > 0) {
        const urls = result.images.map((img: { url: string }) => img.url)
        const validFiles = await tokenFluxService.downloadImages(urls)
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls, status: 'succeeded' })
      }
    })
  }

  const onCancel = () => {
    cancelGeneration({ finishImmediately: true })
  }

  const handleAddPainting = () => {
    const newPainting = addPainting('tokenflux_paintings', getNewPainting())
    updatePainting('tokenflux_paintings', newPainting)
    setPainting(newPainting as TokenFluxPainting)
    return newPainting
  }

  const onDeletePainting = (paintingToDelete: TokenFluxPainting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = tokenFluxPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(tokenFluxPaintings[currentIndex - 1])
      } else if (tokenFluxPaintings.length > 1) {
        setPainting(tokenFluxPaintings[1])
      }
    }

    void removePainting('tokenflux_paintings', paintingToDelete)
  }

  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  const onSelectPainting = (newPainting: TokenFluxPainting) => {
    if (generating) return
    setPainting(newPainting)
    resetImageIndex()

    // Set form data from painting's input params
    if (newPainting.inputParams) {
      // Filter out the prompt from inputParams since it's handled separately
      // oxlint-disable-next-line @typescript-eslint/no-unused-vars
      const { prompt, ...formInputParams } = newPainting.inputParams
      setFormData(formInputParams)
    } else {
      setFormData({})
    }

    // Set selected model if available
    if (newPainting.model) {
      const model = models.find((m) => m.id === newPainting.model)
      if (model) {
        setSelectedModel(model)
      }
    } else {
      setSelectedModel(null)
    }
  }

  const readI18nContext = (property: Record<string, any>, key: string): string => {
    const lang = i18n.language.split('-')[0] // Get the base language code (e.g., 'en' from 'en-US')
    logger.debug('readI18nContext', { property, key, lang })
    return property[`${key}_${lang}`] || property[key]
  }

  useEffect(() => {
    if (tokenFluxPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('tokenflux_paintings', newPainting)
      setPainting(newPainting)
    }
  }, [tokenFluxPaintings, addPainting, getNewPainting])

  useEffect(() => {
    if (painting.status === 'processing' && painting.generationId) {
      tokenFluxService
        .pollGenerationResult(painting.generationId, {
          onStatusUpdate: (updates) => {
            logger.debug('Polling status update:', updates)
            updatePaintingState(updates)
          }
        })
        .then((result) => {
          if (result && result.images && result.images.length > 0) {
            const urls = result.images.map((img: { url: string }) => img.url)
            void tokenFluxService.downloadImages(urls).then(async (validFiles) => {
              await FileManager.addFiles(validFiles)
              updatePaintingState({ files: validFiles, urls, status: 'succeeded' })
            })
          }
        })
        .catch((error) => {
          logger.error('Polling failed:', error)
          updatePaintingState({ status: 'failed' })
        })
    }
  }, [painting.generationId, painting.status, tokenFluxService, updatePaintingState])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          {/* Provider Section */}
          <div className="mb-1.25 flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 8 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href="https://tokenflux.ai">
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon('tokenflux')
                return Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null
              })()}
            </SettingHelpLink>
          </div>

          <ProviderSelect provider={tokenfluxProvider} options={Options} onChange={handleProviderChange} />

          {/* Model & Pricing Section */}
          <div className="mt-3.75 mb-1.25 flex items-center justify-between font-semibold text-[14px] text-foreground">
            {t('paintings.model_and_pricing')}
            {selectedModel && selectedModel.pricing && (
              <div className="flex justify-end">
                <div className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">
                  {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
                  {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
                </div>
              </div>
            )}
          </div>
          <Select
            style={{ width: '100%', marginBottom: 12 }}
            value={selectedModel?.id}
            onChange={handleModelChange}
            placeholder={t('paintings.select_model')}>
            {Object.entries(
              models.reduce(
                (acc, model) => {
                  const provider = model.model_provider || 'Other'
                  if (!acc[provider]) {
                    acc[provider] = []
                  }
                  acc[provider].push(model)
                  return acc
                },
                {} as Record<string, typeof models>
              )
            ).map(([provider, providerModels]) => (
              <Select.OptGroup key={provider} label={provider}>
                {providerModels.map((model) => (
                  <Select.Option key={model.id} value={model.id}>
                    <Tooltip placement="right" content={model.description}>
                      <div className="flex flex-col">
                        <div className="text-foreground">{model.name}</div>
                      </div>
                    </Tooltip>
                  </Select.Option>
                ))}
              </Select.OptGroup>
            ))}
          </Select>

          {/* Input Parameters Section */}
          {selectedModel && selectedModel.input_schema && (
            <>
              <div className="mt-2.5 mb-1.25 flex items-center font-semibold text-[14px] text-foreground">
                {t('paintings.input_parameters')}
              </div>
              <div className="flex flex-col gap-3">
                {Object.entries(selectedModel.input_schema.properties).map(([key, property]: [string, any]) => {
                  if (key === 'prompt') return null // Skip prompt as it's handled separately

                  const isRequired = selectedModel.input_schema.required?.includes(key)

                  return (
                    <div key={key} className="flex flex-col">
                      <div className="mb-1.5 flex items-center">
                        <span className="font-medium text-[13px] text-foreground capitalize">
                          {readI18nContext(property, 'title')}
                          {isRequired && <span className="font-semibold text-destructive"> *</span>}
                        </span>
                        {property.description && <InfoTooltip content={readI18nContext(property, 'description')} />}
                      </div>
                      <DynamicFormRender
                        schemaProperty={property}
                        propertyName={key}
                        value={formData[key]}
                        onChange={handleFormFieldChange}
                      />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      }
      artboard={
        <>
          {/* Check if any form field contains an uploaded image */}
          {Object.keys(formData).some((key) => key.toLowerCase().includes('image') && formData[key]) ? (
            <div className="flex h-full flex-1 flex-row gap-px">
              <div className="flex h-full flex-1 flex-col bg-background [border-right:0.5px_solid_var(--color-border)]">
                <div className="border-border border-b bg-background-subtle px-5 py-2.5 text-center font-medium text-[14px] text-foreground-secondary">
                  {t('paintings.input_image')}
                </div>
                <div className="flex flex-1 items-center justify-center bg-background">
                  {Object.entries(formData).map(([key, value]) => {
                    if (key.toLowerCase().includes('image') && value) {
                      return (
                        <div key={key} className="relative flex items-center justify-center">
                          <img
                            src={value}
                            alt={t('paintings.uploaded_input')}
                            style={{
                              maxWidth: '100%',
                              maxHeight: '70vh',
                              objectFit: 'contain',
                              backgroundColor: 'var(--color-background-subtle)'
                            }}
                          />
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              </div>
              <div className="flex h-full flex-1 flex-col bg-background">
                <div className="border-border border-b bg-background-subtle px-5 py-2.5 text-center font-medium text-[14px] text-foreground-secondary">
                  {t('paintings.generated_image')}
                </div>
                <Artboard
                  painting={painting}
                  isLoading={isLoading}
                  currentImageIndex={currentImageIndex}
                  onPrevImage={prevImage}
                  onNextImage={nextImage}
                  onCancel={onCancel}
                />
              </div>
            </div>
          ) : (
            <Artboard
              painting={painting}
              isLoading={isLoading}
              currentImageIndex={currentImageIndex}
              onPrevImage={prevImage}
              onNextImage={nextImage}
              onCancel={onCancel}
            />
          )}
        </>
      }
      promptBar={
        <PaintingPromptBar
          textareaRef={textareaRef}
          value={painting.prompt || ''}
          disabled={isLoading}
          placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
          onChange={(prompt) => updatePaintingState({ prompt })}
          onKeyDown={handleKeyDown}
          onGenerate={onGenerate}
          translate={{
            onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
            disabled: isLoading || isTranslating,
            isLoading: isTranslating
          }}
        />
      }
      history={
        <PaintingsList
          namespace="tokenflux_paintings"
          paintings={tokenFluxPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting as any}
          onDeletePainting={onDeletePainting as any}
          onNewPainting={handleAddPainting}
        />
      }
    />
  )
}
export default TokenFluxPage
