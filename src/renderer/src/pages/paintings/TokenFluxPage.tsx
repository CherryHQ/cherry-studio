import { PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { LanguagesEnum } from '@renderer/config/translate'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { TokenFluxPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, Select, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { DynamicFormRender } from './components/DynamicFormRender'
import PaintingsList from './components/PaintingsList'
import { DEFAULT_TOKENFLUX_PAINTING, type TokenFluxModel } from './config/tokenFluxConfig'
import TokenFluxService from './utils/TokenFluxService'

const logger = loggerService.withContext('TokenFluxPage')

const TokenFluxPage: FC<{ Options: string[] }> = ({ Options }) => {
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
  const { addPainting, removePainting, updatePainting, persistentData } = usePaintings()
  const tokenFluxPaintings = useMemo(() => persistentData.tokenFluxPaintings || [], [persistentData.tokenFluxPaintings])
  const [painting, setPainting] = useState<TokenFluxPainting>(
    tokenFluxPaintings[0] || { ...DEFAULT_TOKENFLUX_PAINTING, id: uuid() }
  )

  const providerOptions = Options.map((option) => {
    const provider = providers.find((p) => p.id === option)
    return {
      label: t(`provider.${provider?.id}`),
      value: provider?.id
    }
  })

  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const tokenfluxProvider = providers.find((p) => p.id === 'tokenflux')!
  const textareaRef = useRef<any>(null)
  const tokenFluxService = useMemo(
    () => new TokenFluxService(tokenfluxProvider.apiHost, tokenfluxProvider.apiKey),
    [tokenfluxProvider]
  )

  useEffect(() => {
    tokenFluxService.fetchModels().then((models) => {
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
        updatePainting('tokenFluxPaintings', updatedPainting)
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
    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''

    if (!tokenfluxProvider.enabled) {
      window.modal.error({
        content: t('error.provider_disabled'),
        centered: true
      })
      return
    }

    if (!tokenfluxProvider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

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
    dispatch(setGenerating(true))

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
      dispatch(setGenerating(false))
      setAbortController(null)
    } catch (error: unknown) {
      handleError(error)
      setIsLoading(false)
      dispatch(setGenerating(false))
      setAbortController(null)
    }
  }

  const onCancel = () => {
    abortController?.abort()
    setIsLoading(false)
    dispatch(setGenerating(false))
    setAbortController(null)
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const handleAddPainting = () => {
    const newPainting = addPainting('tokenFluxPaintings', getNewPainting())
    updatePainting('tokenFluxPaintings', newPainting)
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

    removePainting('tokenFluxPaintings', paintingToDelete)
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
        translate()
      }
    }
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      navigate('../' + providerId, { replace: true })
    }
  }

  const onSelectPainting = (newPainting: TokenFluxPainting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)

    // Set form data from painting's input params
    if (newPainting.inputParams) {
      // Filter out the prompt from inputParams since it's handled separately
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      addPainting('tokenFluxPaintings', newPainting)
      setPainting(newPainting)
    }
  }, [tokenFluxPaintings, addPainting, getNewPainting])

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
            tokenFluxService.downloadImages(urls).then(async (validFiles) => {
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
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="small" className="nodrag" icon={<PlusOutlined />} onClick={handleAddPainting}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          {/* Provider Section */}
          <ProviderTitleContainer>
            <SettingTitle style={{ marginBottom: 8 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href="https://tokenflux.ai">
              {t('paintings.learn_more')}
              <ProviderLogo shape="square" src={getProviderLogo('tokenflux')} size={16} style={{ marginLeft: 5 }} />
            </SettingHelpLink>
          </ProviderTitleContainer>

          <Select
            value={providerOptions.find((p) => p.value === 'tokenflux')?.value}
            onChange={handleProviderChange}
            style={{ width: '100%' }}>
            {providerOptions.map((provider) => (
              <Select.Option value={provider.value} key={provider.value}>
                <SelectOptionContainer>
                  <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
                  {provider.label}
                </SelectOptionContainer>
              </Select.Option>
            ))}
          </Select>

          {/* Model & Pricing Section */}
          <SectionTitle
            style={{ marginBottom: 5, marginTop: 15, justifyContent: 'space-between', alignItems: 'center' }}>
            {t('paintings.model_and_pricing')}
            {selectedModel && selectedModel.pricing && (
              <PricingContainer>
                <PricingBadge>
                  {selectedModel.pricing.price} {selectedModel.pricing.currency}{' '}
                  {selectedModel.pricing.unit > 1 ? t('paintings.per_images') : t('paintings.per_image')}
                </PricingBadge>
              </PricingContainer>
            )}
          </SectionTitle>
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
                    <Tooltip title={model.description} placement="right">
                      <ModelOptionContainer>
                        <ModelName>{model.name}</ModelName>
                      </ModelOptionContainer>
                    </Tooltip>
                  </Select.Option>
                ))}
              </Select.OptGroup>
            ))}
          </Select>

          {/* Input Parameters Section */}
          {selectedModel && selectedModel.input_schema && (
            <>
              <SectionTitle style={{ marginBottom: 5, marginTop: 10 }}>{t('paintings.input_parameters')}</SectionTitle>
              <ParametersContainer>
                {Object.entries(selectedModel.input_schema.properties).map(([key, property]: [string, any]) => {
                  if (key === 'prompt') return null // Skip prompt as it's handled separately

                  const isRequired = selectedModel.input_schema.required?.includes(key)

                  return (
                    <ParameterField key={key}>
                      <ParameterLabel>
                        <ParameterName>
                          {readI18nContext(property, 'title')}
                          {isRequired && <RequiredIndicator> *</RequiredIndicator>}
                        </ParameterName>
                        {property.description && (
                          <Tooltip title={readI18nContext(property, 'description')}>
                            <InfoIcon />
                          </Tooltip>
                        )}
                      </ParameterLabel>
                      <DynamicFormRender
                        schemaProperty={property}
                        propertyName={key}
                        value={formData[key]}
                        onChange={handleFormFieldChange}
                      />
                    </ParameterField>
                  )
                })}
              </ParametersContainer>
            </>
          )}
        </LeftContainer>

        <MainContainer>
          {/* Check if any form field contains an uploaded image */}
          {Object.keys(formData).some((key) => key.toLowerCase().includes('image') && formData[key]) ? (
            <ComparisonContainer>
              <ImageComparisonSection>
                <SectionLabel>{t('paintings.input_image')}</SectionLabel>
                <UploadedImageContainer>
                  {Object.entries(formData).map(([key, value]) => {
                    if (key.toLowerCase().includes('image') && value) {
                      return (
                        <ImageWrapper key={key}>
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
                        </ImageWrapper>
                      )
                    }
                    return null
                  })}
                </UploadedImageContainer>
              </ImageComparisonSection>
              <ImageComparisonSection>
                <SectionLabel>{t('paintings.generated_image')}</SectionLabel>
                <Artboard
                  painting={painting}
                  isLoading={isLoading}
                  currentImageIndex={currentImageIndex}
                  onPrevImage={prevImage}
                  onNextImage={nextImage}
                  onCancel={onCancel}
                />
              </ImageComparisonSection>
            </ComparisonContainer>
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
          <InputContainer>
            <Textarea
              ref={textareaRef}
              variant="borderless"
              disabled={isLoading}
              value={painting.prompt || ''}
              spellCheck={false}
              onChange={(e) => updatePaintingState({ prompt: e.target.value })}
              placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
              onKeyDown={handleKeyDown}
            />
            <Toolbar>
              <ToolbarMenu>
                <TranslateButton
                  text={textareaRef.current?.resizableTextArea?.textArea?.value}
                  onTranslated={(translatedText) => updatePaintingState({ prompt: translatedText })}
                  disabled={isLoading || isTranslating}
                  isLoading={isTranslating}
                  style={{ marginRight: 6, borderRadius: '50%' }}
                />
                <SendMessageButton sendMessage={onGenerate} disabled={isLoading} />
              </ToolbarMenu>
            </Toolbar>
          </InputContainer>
        </MainContainer>

        <PaintingsList
          namespace="tokenFluxPaintings"
          paintings={tokenFluxPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting as any}
          onDeletePainting={onDeletePainting as any}
          onNewPainting={handleAddPainting}
        />
      </ContentContainer>
    </Container>
  )
}

const SectionTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
`

const ModelOptionContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const ModelName = styled.div`
  color: var(--color-text);
`

const PricingContainer = styled.div`
  display: flex;
  justify-content: flex-end;
`

const PricingBadge = styled.div`
  background-color: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 0;
  border-radius: 4px;
  border: 1px solid var(--color-primary-border);
`

const ParametersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ParameterField = styled.div`
  display: flex;
  flex-direction: column;
`

const ParameterLabel = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 6px;
`

const ParameterName = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  text-transform: capitalize;
`

const RequiredIndicator = styled.span`
  color: var(--color-error);
  font-weight: 600;
`

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: 100%;
  background-color: var(--color-background);
  overflow: hidden;
`

const LeftContainer = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  background-color: var(--color-background);
  max-width: var(--assistants-width);
  border-right: 0.5px solid var(--color-border);
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background);
`

const ComparisonContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: 100%;
  gap: 1px;
`

const ImageComparisonSection = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background);
  &:first-child {
    border-right: 0.5px solid var(--color-border);
  }
`

const SectionLabel = styled.div`
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-2);
  background-color: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  text-align: center;
`

const UploadedImageContainer = styled.div`
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background);
`

const ImageWrapper = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
`

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 95px;
  max-height: 95px;
  position: relative;
  border: 1px solid var(--color-border-soft);
  transition: all 0.3s ease;
  margin: 0 20px 15px 20px;
  border-radius: 10px;
`

const Textarea = styled(TextArea)`
  padding: 10px;
  border-radius: 0;
  display: flex;
  flex: 1;
  resize: none !important;
  overflow: auto;
  width: auto;
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  justify-content: flex-end;
  padding: 0 8px;
  padding-bottom: 0;
  height: 40px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

const InfoIcon = styled(Info)`
  margin-left: 5px;
  cursor: help;
  color: var(--color-text-2);
  opacity: 0.6;
  width: 14px;
  height: 16px;

  &:hover {
    opacity: 1;
  }
`

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
`

const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default TokenFluxPage
