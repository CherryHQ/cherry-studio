import { PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo, PROVIDER_URLS } from '@renderer/config/providers'
import { LanguagesEnum } from '@renderer/config/translate'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { VercelGatewayPainting } from '@renderer/types'
import type { FileMetadata } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, Select, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import type { VercelGatewayPaintingResponse } from './config/vercelGatewayConfig'
import { DEFAULT_VERCEL_GATEWAY_PAINTING, MODELS } from './config/vercelGatewayConfig'
import { checkProviderEnabled } from './utils'

const logger = loggerService.withContext('VercelGatewayPage')

const VercelGatewayPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [models, setModels] = useState<typeof MODELS>(MODELS)
  const [selectedModel, setSelectedModel] = useState<(typeof MODELS)[0] | null>(MODELS[0])
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)

  const { t } = useTranslation()
  const providers = useAllProviders()
  const { addPainting, removePainting, updatePainting, vercel_gateway_paintings } = usePaintings()
  const vercelGatewayPaintings = vercel_gateway_paintings ?? []
  const [painting, setPainting] = useState<VercelGatewayPainting>(
    vercelGatewayPaintings[0] || {
      ...DEFAULT_VERCEL_GATEWAY_PAINTING,
      id: uuid(),
      providerId: 'gateway'
    }
  )

  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const gatewayProvider = providers.find((p) => p.id === 'gateway')!
  const textareaRef = useRef<any>(null)

  useEffect(() => {
    setModels(MODELS)
    if (MODELS.length > 0) {
      setSelectedModel(MODELS[0])
    }
    logger.setLogToMainLevel('debug')
    logger.debug(JSON.stringify(gatewayProvider.models))
  }, [])

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_VERCEL_GATEWAY_PAINTING,
      id: uuid(),
      model: selectedModel?.name || '',
      providerId: 'gateway',
      inputParams: {}
    }
  }, [selectedModel])

  const updatePaintingState = useCallback(
    (updates: Partial<VercelGatewayPainting>) => {
      setPainting((prevPainting) => {
        const updatedPainting = { ...prevPainting, ...updates }
        updatePainting('vercel_gateway_paintings', updatedPainting)
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

  const handleModelChange = (modelName: string) => {
    const model = models.find((m) => m.name === modelName)
    if (model) {
      setSelectedModel(model)
      setFormData({})
      updatePaintingState({ model: model.name, inputParams: {} })
    }
  }

  const onGenerate = async () => {
    await checkProviderEnabled(gatewayProvider, t)

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

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    dispatch(setGenerating(true))

    try {
      const requestBody = {
        model: selectedModel.name,
        prompt
      }

      const inputParams = { prompt, ...formData }
      updatePaintingState({
        model: selectedModel.name,
        prompt,
        status: 'processing',
        inputParams
      })

      const response = await fetch(`${gatewayProvider.apiHost}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gatewayProvider.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || t('paintings.generate_failed'))
      }

      const data: VercelGatewayPaintingResponse = await response.json()
      // logger.error(JSON.stringify(data))
      const urls = data.data.filter((item) => item.url).map((item) => item.url) as string[]
      const base64s = data.data.filter((item) => item.b64_json).map((item) => item.b64_json) as string[]

      if (urls?.length > 0) {
        const validFiles = await downloadImages(urls)
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls, metadata: data.providerMetadata, usage: data.usage })
      }

      if (base64s?.length > 0) {
        const validFiles = await Promise.all(
          base64s.map(async (base64) => {
            return await window.api.file.saveBase64Image(base64)
          })
        )
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls: [], metadata: data.providerMetadata, usage: data.usage })
      }
    } catch (error: unknown) {
      handleError(error)
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
      setAbortController(null)
    }
  }

  const downloadImages = async (urls: string[]) => {
    const downloadedFiles = await Promise.all(
      urls.map(async (url) => {
        try {
          if (!url?.trim()) {
            logger.error('empty url')
            window.toast.warning(t('message.empty_url'))
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          logger.error('Image Download Error:', error as Error)
          if (
            error instanceof Error &&
            (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
          ) {
            window.toast.warning(t('message.empty_url'))
          }
          return null
        }
      })
    )

    return downloadedFiles.filter((file): file is FileMetadata => file !== null)
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
    const newPainting = getNewPainting()
    addPainting('vercel_gateway_paintings', newPainting)
    setPainting(newPainting as VercelGatewayPainting)
    return newPainting
  }

  const onDeletePainting = (paintingToDelete: VercelGatewayPainting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = vercelGatewayPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(vercelGatewayPaintings[currentIndex - 1])
      } else if (vercelGatewayPaintings.length > 1) {
        setPainting(vercelGatewayPaintings[1])
      }
    }

    void removePainting('vercel_gateway_paintings', paintingToDelete)
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
      navigate('../' + providerId, { replace: true })
    }
  }

  const onSelectPainting = (newPainting: VercelGatewayPainting) => {
    if (generating) return
    setPainting(newPainting)
    logger.debug(JSON.stringify(newPainting))
    setCurrentImageIndex(0)

    if (newPainting.inputParams) {
      const { ...formInputParams } = newPainting.inputParams
      setFormData(formInputParams)
    } else {
      setFormData({})
    }

    if (newPainting.model) {
      const model = models.find((m) => m.name === newPainting.model)
      if (model) {
        setSelectedModel(model)
      }
    } else {
      setSelectedModel(null)
    }
  }

  useEffect(() => {
    if (vercelGatewayPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('vercel_gateway_paintings', newPainting)
      setPainting(newPainting)
    }
  }, [vercelGatewayPaintings, addPainting, getNewPainting])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

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
          <ProviderTitleContainer>
            <SettingTitle style={{ marginBottom: 8 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink
              target="_blank"
              href={PROVIDER_URLS.gateway?.websites?.official || 'https://vercel.com/ai-gateway'}>
              {t('paintings.learn_more')}
              <ProviderLogo shape="square" src={getProviderLogo('gateway')} size={16} style={{ marginLeft: 5 }} />
            </SettingHelpLink>
          </ProviderTitleContainer>
          <ProviderSelect provider={gatewayProvider} options={Options} onChange={handleProviderChange} />
          <SectionTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.model')}</SectionTitle>
          <Select
            style={{ width: '100%', marginBottom: 12 }}
            value={selectedModel?.name}
            onChange={handleModelChange}
            placeholder={t('paintings.select_model')}>
            {models.map((model) => (
              <Select.Option key={model.name} value={model.name}>
                <Tooltip title={model.label}>
                  <ModelOptionContainer>
                    <ModelName>{model.label}</ModelName>
                  </ModelOptionContainer>
                </Tooltip>
              </Select.Option>
            ))}
          </Select>
          <div style={{ fontSize: 'small', marginTop: -8, marginLeft: 10 }}>{selectedModel?.name}</div>
          {selectedModel && selectedModel.imageSizes && (
            <>
              <SectionTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SectionTitle>
              <Select
                style={{ width: '100%', marginBottom: 12 }}
                value={painting.size || 'auto'}
                onChange={(value) => updatePaintingState({ size: value })}>
                {selectedModel.imageSizes.map((size) => (
                  <Select.Option key={size.value} value={size.value}>
                    {size.value}
                  </Select.Option>
                ))}
              </Select>
            </>
          )}
          {selectedModel && selectedModel.quality && (
            <>
              <SectionTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.quality')}</SectionTitle>
              <Select
                style={{ width: '100%', marginBottom: 12 }}
                value={painting.quality || 'auto'}
                onChange={(value) => updatePaintingState({ quality: value })}>
                {selectedModel.quality.map((q) => (
                  <Select.Option key={q.value} value={q.value}>
                    {q.value}
                  </Select.Option>
                ))}
              </Select>
            </>
          )}
          {selectedModel && selectedModel.background && (
            <>
              <SectionTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.background')}</SectionTitle>
              <Select
                style={{ width: '100%', marginBottom: 12 }}
                value={painting.background || 'auto'}
                onChange={(value) => updatePaintingState({ background: value })}>
                {selectedModel.background.map((b) => (
                  <Select.Option key={b.value} value={b.value}>
                    {b.value}
                  </Select.Option>
                ))}
              </Select>
            </>
          )}
        </LeftContainer>

        <MainContainer>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
          />
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
          namespace="vercel_gateway_paintings"
          paintings={vercelGatewayPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
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
`

const ModelOptionContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const ModelName = styled.div`
  color: var(--color-text);
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

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
`

export default VercelGatewayPage
