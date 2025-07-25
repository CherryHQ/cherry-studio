import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack, VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { TEXT_TO_IMAGES_MODELS } from '@renderer/config/models'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { getProviderLabel } from '@renderer/i18n/label'
import { getProviderByModel } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileMetadata, Painting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Button, Input, InputNumber, Radio, Select, Slider, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingsList from './components/PaintingsList'

const logger = loggerService.withContext('SiliconPage')

const IMAGE_SIZES = [
  {
    label: '1:1',
    value: '1024x1024',
    icon: ImageSize1_1
  },
  {
    label: '1:2',
    value: '512x1024',
    icon: ImageSize1_2
  },
  {
    label: '3:2',
    value: '768x512',
    icon: ImageSize3_2
  },
  {
    label: '3:4',
    value: '768x1024',
    icon: ImageSize3_4
  },
  {
    label: '16:9',
    value: '1024x576',
    icon: ImageSize16_9
  },
  {
    label: '9:16',
    value: '576x1024',
    icon: ImageSize9_16
  }
]
const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

const DEFAULT_PAINTING: Painting = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  steps: 25,
  guidanceScale: 4.5,
  model: TEXT_TO_IMAGES_MODELS[0].id
}

// let _painting: Painting

const SiliconPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { t } = useTranslation()
  const { paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<Painting>(paintings[0] || DEFAULT_PAINTING)
  const { theme } = useTheme()
  const providers = useAllProviders()
  const providerOptions = Options.map((option) => {
    const provider = providers.find((p) => p.id === option)
    if (provider) {
      return {
        label: getProviderLabel(provider.id),
        value: provider.id
      }
    } else {
      return {
        label: 'Unknown Provider',
        value: undefined
      }
    }
  })
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()

  const getNewPainting = () => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      seed: generateRandomSeed()
    }
  }

  const modelOptions = TEXT_TO_IMAGES_MODELS.map((model) => ({
    label: model.name,
    value: model.id
  }))

  const textareaRef = useRef<any>(null)
  // _painting = painting

  const updatePaintingState = (updates: Partial<Painting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('paintings', updatedPainting)
  }

  const onSelectModel = (modelId: string) => {
    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === modelId)
    if (model) {
      updatePaintingState({ model: modelId })
    }
  }

  const onGenerate = async () => {
    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) {
        return
      }

      await FileManager.deleteFiles(painting.files)
    }

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''

    updatePaintingState({ prompt })

    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === painting.model)
    const provider = getProviderByModel(model)

    if (!provider.enabled) {
      window.modal.error({
        content: t('error.provider_disabled'),
        centered: true
      })
      return
    }

    if (!provider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    dispatch(setGenerating(true))
    const AI = new AiProvider(provider)

    if (!painting.model) {
      return
    }

    try {
      const urls = await AI.generateImage({
        model: painting.model,
        prompt,
        negativePrompt: painting.negativePrompt || '',
        imageSize: painting.imageSize || '1024x1024',
        batchSize: painting.numImages || 1,
        seed: painting.seed || undefined,
        numInferenceSteps: painting.steps || 25,
        guidanceScale: painting.guidanceScale || 4.5,
        signal: controller.signal,
        promptEnhancement: painting.promptEnhancement || false
      })

      if (urls.length > 0) {
        const downloadedFiles = await Promise.all(
          urls.map(async (url) => {
            try {
              if (!url || url.trim() === '') {
                logger.error('图像URL为空，可能是提示词违禁')
                window.message.warning({
                  content: t('message.empty_url'),
                  key: 'empty-url-warning'
                })
                return null
              }
              return await window.api.file.download(url)
            } catch (error) {
              logger.error('Failed to download image:', error as Error)
              if (
                error instanceof Error &&
                (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
              ) {
                window.message.warning({
                  content: t('message.empty_url'),
                  key: 'empty-url-warning'
                })
              }
              return null
            }
          })
        )

        const validFiles = downloadedFiles.filter((file): file is FileMetadata => file !== null)

        await FileManager.addFiles(validFiles)

        updatePaintingState({ files: validFiles, urls })
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content: getErrorMessage(error),
          centered: true
        })
      }
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
      setAbortController(null)
    }
  }

  const onCancel = () => {
    abortController?.abort()
  }

  const onSelectImageSize = (v: string) => {
    const size = IMAGE_SIZES.find((i) => i.value === v)
    size && updatePaintingState({ imageSize: size.value })
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const onDeletePainting = (paintingToDelete: Painting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(paintings[currentIndex - 1])
      } else if (paintings.length > 1) {
        setPainting(paintings[1])
      }
    }

    removePainting('paintings', paintingToDelete)
  }

  const onSelectPainting = (newPainting: Painting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const { autoTranslateWithSpace } = useSettings()
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

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

  useEffect(() => {
    if (paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('paintings', newPainting)
      setPainting(newPainting)
    }

    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [paintings.length, addPainting])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              className="nodrag"
              icon={<PlusOutlined />}
              onClick={() => setPainting(addPainting('paintings', getNewPainting()))}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
          <Select value={providerOptions[1].value} onChange={handleProviderChange} options={providerOptions} />
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('common.model')}</SettingTitle>
          <Select value={painting.model} options={modelOptions} onChange={onSelectModel} />
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
          <Radio.Group
            value={painting.imageSize}
            onChange={(e) => onSelectImageSize(e.target.value)}
            style={{ display: 'flex' }}>
            {IMAGE_SIZES.map((size) => (
              <RadioButton value={size.value} key={size.value}>
                <VStack alignItems="center">
                  <ImageSizeImage src={size.icon} theme={theme} />
                  <span>{size.label}</span>
                </VStack>
              </RadioButton>
            ))}
          </Radio.Group>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.number_images')}
            <Tooltip title={t('paintings.number_images_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <InputNumber
            min={1}
            max={4}
            value={painting.numImages}
            onChange={(v) => updatePaintingState({ numImages: v || 1 })}
          />

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.seed')}
            <Tooltip title={t('paintings.seed_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <Input
            value={painting.seed}
            onChange={(e) => updatePaintingState({ seed: e.target.value })}
            suffix={
              <RedoOutlined
                onClick={() => updatePaintingState({ seed: Math.floor(Math.random() * 1000000).toString() })}
                style={{ cursor: 'pointer', color: 'var(--color-text-2)' }}
              />
            }
          />

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.inference_steps')}
            <Tooltip title={t('paintings.inference_steps_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <SliderContainer>
            <Slider min={1} max={50} value={painting.steps} onChange={(v) => updatePaintingState({ steps: v })} />
            <StyledInputNumber
              min={1}
              max={50}
              value={painting.steps}
              onChange={(v) => updatePaintingState({ steps: (v as number) || 25 })}
            />
          </SliderContainer>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.guidance_scale')}
            <Tooltip title={t('paintings.guidance_scale_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <SliderContainer>
            <Slider
              min={1}
              max={20}
              step={0.1}
              value={painting.guidanceScale}
              onChange={(v) => updatePaintingState({ guidanceScale: v })}
            />
            <StyledInputNumber
              min={1}
              max={20}
              step={0.1}
              value={painting.guidanceScale}
              onChange={(v) => updatePaintingState({ guidanceScale: (v as number) || 4.5 })}
            />
          </SliderContainer>
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.negative_prompt')}
            <Tooltip title={t('paintings.negative_prompt_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <TextArea
            value={painting.negativePrompt}
            onChange={(e) => updatePaintingState({ negativePrompt: e.target.value })}
            spellCheck={false}
            rows={4}
          />
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.prompt_enhancement')}
            <Tooltip title={t('paintings.prompt_enhancement_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <HStack>
            <Switch
              checked={painting.promptEnhancement}
              onChange={(checked) => updatePaintingState({ promptEnhancement: checked })}
            />
          </HStack>
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
              value={painting.prompt}
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
          namespace="paintings"
          paintings={paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={() => setPainting(addPainting('paintings', getNewPainting()))}
        />
      </ContentContainer>
    </Container>
  )
}

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

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  margin-top: 8px;
`

const RadioButton = styled(Radio.Button)`
  width: 30px;
  height: 55px;
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
`

const InfoIcon = styled(Info)`
  margin-left: 5px;
  cursor: help;
  color: var(--color-text-2);
  opacity: 0.6;
  width: 16px;
  height: 16px;

  &:hover {
    opacity: 1;
  }
`

const SliderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;

  .ant-slider {
    flex: 1;
  }
`

const StyledInputNumber = styled(InputNumber)`
  width: 70px;
`

export default SiliconPage
