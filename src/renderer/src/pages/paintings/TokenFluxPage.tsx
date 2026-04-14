import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  InfoTooltip,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { LanguagesEnum } from '@renderer/config/translate'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { TokenFluxPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { DynamicFormRender } from './components/DynamicFormRender'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { DEFAULT_TOKENFLUX_PAINTING, type TokenFluxModel } from './config/tokenFluxConfig'
import { checkProviderEnabled } from './utils'
import TokenFluxService from './utils/TokenFluxService'

const logger = loggerService.withContext('TokenFluxPage')

const TokenFluxPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [generating, setGenerating] = useCache('chat.generating')
  const [models, setModels] = useState<TokenFluxModel[]>([])
  const [selectedModel, setSelectedModel] = useState<TokenFluxModel | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)

  const { t, i18n } = useTranslation()
  const providers = useAllProviders()
  const {
    items: tokenFluxPaintings,
    add: addPaintingScoped,
    remove: removePaintingScoped,
    update: updatePaintingScoped,
    reorder
  } = usePaintingList({ providerId: 'tokenflux', mode: 'generate' })
  const [painting, setPainting] = useState<TokenFluxPainting>(
    tokenFluxPaintings[0] || { ...DEFAULT_TOKENFLUX_PAINTING, id: uuid() }
  )

  const navigate = useNavigate()
  const location = useLocation()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const tokenfluxProvider = providers.find((p) => p.id === 'tokenflux')!
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
        updatePaintingScoped(updatedPainting)
        return updatedPainting
      })
    },
    [updatePaintingScoped]
  )

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') {
      window.modal.error({
        content: getErrorMessage(error),
        centered: true
      })
    }
  }

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

    const prompt = painting.prompt || ''

    if (!selectedModel || !prompt) {
      window.modal.error({
        content: t('paintings.text_desc_required'),
        centered: true
      })
      return
    }

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    setGenerating(true)

    try {
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
        signal: controller.signal,
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

      setIsLoading(false)
      setGenerating(false)
      setAbortController(null)
    } catch (error: unknown) {
      handleError(error)
      setIsLoading(false)
      setGenerating(false)
      setAbortController(null)
    }
  }

  const onCancel = () => {
    abortController?.abort()
    setIsLoading(false)
    setGenerating(false)
    setAbortController(null)
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const handleAddPainting = () => {
    const newPainting = addPaintingScoped(getNewPainting())
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

    void removePaintingScoped(paintingToDelete)
  }

  const translate = async () => {
    if (isTranslating) {
      return
    }

    if (!painting.prompt) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(painting.prompt, LanguagesEnum.enUS)
      updatePaintingState({ prompt: translatedText })
    } catch (error) {
      logger.error('Translation failed:', error as Error)
    } finally {
      setIsTranslating(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autoTranslateWithSpace && event.key === ' ') {
      setSpaceClickCount((prev) => prev + 1)

      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }

      spaceClickTimer.current = setTimeout(() => {
        setSpaceClickCount(0)
      }, 200)

      if (spaceClickCount === 2) {
        setSpaceClickCount(0)
        setIsTranslating(true)
        void translate()
      }
    }
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  const onSelectPainting = (newPainting: TokenFluxPainting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)

    // Set form data from painting's input params
    if (newPainting.inputParams) {
      const formInputParams = { ...newPainting.inputParams }
      delete formInputParams.prompt
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
      addPaintingScoped(newPainting)
      setPainting(newPainting)
    }
  }, [tokenFluxPaintings, addPaintingScoped, getNewPainting])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

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
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" className="nodrag" onClick={handleAddPainting}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-[var(--color-background)]">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] p-5">
          {/* Provider Section */}
          <div className="mb-[5px] flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 8 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href="https://tokenflux.ai">
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon('tokenflux')
                return Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null
              })()}
            </SettingHelpLink>
          </div>

          <ProviderSelect provider={tokenfluxProvider} options={Options} onChange={handleProviderChange} />

          {/* Model & Pricing Section */}
          <div className="mb-[5px] mt-[15px] flex items-center justify-between text-[14px] font-semibold text-[var(--color-text)]">
            {t('paintings.model_and_pricing')}
            {selectedModel && selectedModel.pricing && (
              <div className="flex justify-end">
                <div className="rounded border border-[var(--color-primary-border)] bg-[var(--color-primary-bg)] px-0 py-1 text-[11px] font-medium text-[var(--color-primary)]">
                  {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
                  {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
                </div>
              </div>
            )}
          </div>
          <Select value={selectedModel?.id} onValueChange={handleModelChange}>
            <SelectTrigger className="mb-3 w-full">
              <SelectValue placeholder={t('paintings.select_model')} />
            </SelectTrigger>
            <SelectContent>
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
                <SelectGroup key={provider}>
                  <SelectLabel>{provider}</SelectLabel>
                  {providerModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <Tooltip content={model.description}>
                        <div className="flex flex-col">
                          <div className="text-[var(--color-text)]">{model.name}</div>
                        </div>
                      </Tooltip>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {/* Input Parameters Section */}
          {selectedModel && selectedModel.input_schema && (
            <>
              <div className="mb-[5px] mt-[10px] flex items-center text-[14px] font-semibold text-[var(--color-text)]">
                {t('paintings.input_parameters')}
              </div>
              <div className="flex flex-col gap-3">
                {Object.entries(selectedModel.input_schema.properties).map(([key, property]: [string, any]) => {
                  if (key === 'prompt') return null // Skip prompt as it's handled separately

                  const isRequired = selectedModel.input_schema.required?.includes(key)

                  return (
                    <div key={key} className="flex flex-col">
                      <div className="mb-1.5 flex items-center">
                        <span className="text-[13px] font-medium capitalize text-[var(--color-text)]">
                          {readI18nContext(property, 'title')}
                          {isRequired && <span className="font-semibold text-[var(--color-error)]"> *</span>}
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
        </Scrollbar>

        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
          {/* Check if any form field contains an uploaded image */}
          {Object.keys(formData).some((key) => key.toLowerCase().includes('image') && formData[key]) ? (
            <div className="flex h-full flex-1 flex-row gap-px">
              <div className="flex h-full flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)]">
                <div className="border-b border-[var(--color-border)] bg-[var(--color-background-soft)] px-5 py-2.5 text-center text-[14px] font-medium text-[var(--color-text-2)]">
                  {t('paintings.input_image')}
                </div>
                <div className="flex flex-1 items-center justify-center bg-[var(--color-background)]">
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
                              backgroundColor: 'var(--color-background-soft)'
                            }}
                          />
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              </div>
              <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
                <div className="border-b border-[var(--color-border)] bg-[var(--color-background-soft)] px-5 py-2.5 text-center text-[14px] font-medium text-[var(--color-text-2)]">
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
          <PaintingPromptBar
            prompt={painting.prompt || ''}
            disabled={isLoading}
            placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
            onPromptChange={(value) => updatePaintingState({ prompt: value })}
            onGenerate={onGenerate}
            onKeyDown={handleKeyDown}
            showTranslate
            isTranslating={isTranslating}
            onTranslated={(translatedText) => updatePaintingState({ prompt: translatedText })}
          />
        </div>

        <PaintingsList
          paintings={tokenFluxPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting as any}
          onDeletePainting={onDeletePainting as any}
          onNewPainting={handleAddPainting}
          onReorder={reorder}
        />
      </div>
    </div>
  )
}
export default TokenFluxPage
