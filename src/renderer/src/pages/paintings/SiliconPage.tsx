import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import {
  Button,
  ColFlex,
  InfoTooltip,
  Input,
  RadioGroup,
  RadioGroupItem,
  RowFlex,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch
} from '@cherrystudio/ui'
import { Textarea } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { getProviderByModel } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, Painting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { checkProviderEnabled } from './utils'

export const TEXT_TO_IMAGES_MODELS = [
  {
    id: 'Kwai-Kolors/Kolors',
    provider: 'silicon',
    name: 'Kolors',
    group: 'Kwai-Kolors'
  },
  {
    id: 'Qwen/Qwen-Image',
    provider: 'silicon',
    name: 'Qwen-Image',
    group: 'qwen'
  }
]

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
  const {
    items: siliconflow_paintings,
    add: addPaintingScoped,
    remove: removePaintingScoped,
    update: updatePaintingScoped,
    reorder
  } = usePaintingList({ providerId: 'silicon', mode: 'generate' })
  const [painting, setPainting] = useState<Painting>(siliconflow_paintings[0] || DEFAULT_PAINTING)
  const { theme } = useTheme()
  const providers = useAllProviders()

  const siliconFlowProvider = providers.find((p) => p.id === 'silicon')!
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')
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

  // _painting = painting

  const updatePaintingState = (updates: Partial<Painting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePaintingScoped(updatedPainting)
  }

  const onSelectModel = (modelId: string) => {
    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === modelId)
    if (model) {
      updatePaintingState({ model: modelId })
    }
  }

  const onGenerate = async () => {
    await checkProviderEnabled(siliconFlowProvider, t)

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

    const prompt = painting.prompt || ''

    updatePaintingState({ prompt })

    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === painting.model)
    const provider = getProviderByModel(model)

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
    setGenerating(true)
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
                window.toast.warning(t('message.empty_url'))
                return null
              }
              return await window.api.file.download(url)
            } catch (error) {
              logger.error('Failed to download image:', error as Error)
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
      setGenerating(false)
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
      const currentIndex = siliconflow_paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(siliconflow_paintings[currentIndex - 1])
      } else if (siliconflow_paintings.length > 1) {
        setPainting(siliconflow_paintings[1])
      }
    }

    void removePaintingScoped(paintingToDelete)
  }

  const onSelectPainting = (newPainting: Painting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
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

  useEffect(() => {
    if (siliconflow_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPaintingScoped(newPainting)
      setPainting(newPainting)
    }

    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [siliconflow_paintings.length, addPaintingScoped])

  return (
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" className="nodrag" onClick={() => setPainting(addPaintingScoped(getNewPainting()))}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-[var(--color-background)]">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] p-5">
          <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
          <ProviderSelect provider={siliconFlowProvider} options={Options} onChange={handleProviderChange} />
          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <Select value={painting.model} onValueChange={onSelectModel}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('common.model')} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
          <RadioGroup value={painting.imageSize} className="grid grid-cols-3 gap-2" onValueChange={onSelectImageSize}>
            {IMAGE_SIZES.map((size) => (
              <label
                key={size.value}
                htmlFor={`silicon-size-${size.value}`}
                className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-border bg-muted/20 p-2 text-sm transition-colors hover:bg-muted/30">
                <RadioGroupItem value={size.value} id={`silicon-size-${size.value}`} className="sr-only" />
                <ColFlex className="items-center">
                  <img
                    src={size.icon}
                    className="mt-2"
                    style={{ filter: theme === 'dark' ? 'invert(100%)' : 'none' }}
                  />
                  <span>{size.label}</span>
                </ColFlex>
              </label>
            ))}
          </RadioGroup>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.number_images')}
            <InfoTooltip content={t('paintings.number_images_tip')} />
          </SettingTitle>
          <Input
            type="number"
            min={1}
            max={4}
            value={String(painting.numImages ?? 1)}
            onChange={(e) => updatePaintingState({ numImages: Number(e.target.value) || 1 })}
          />

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.seed')}
            <InfoTooltip content={t('paintings.seed_tip')} />
          </SettingTitle>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={painting.seed}
              onChange={(e) => updatePaintingState({ seed: e.target.value })}
            />
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => updatePaintingState({ seed: Math.floor(Math.random() * 1000000).toString() })}>
              <RedoOutlined />
            </Button>
          </div>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.inference_steps')}
            <InfoTooltip content={t('paintings.inference_steps_tip')} />
          </SettingTitle>
          <div className="flex items-center gap-4">
            <Slider
              className="flex-1"
              min={1}
              max={50}
              value={[painting.steps ?? 25]}
              onValueChange={(values) => updatePaintingState({ steps: values[0] })}
            />
            <Input
              className="w-[70px]"
              type="number"
              min={1}
              max={50}
              value={String(painting.steps ?? 25)}
              onChange={(e) => updatePaintingState({ steps: Number(e.target.value) || 25 })}
            />
          </div>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.guidance_scale')}
            <InfoTooltip content={t('paintings.guidance_scale_tip')} />
          </SettingTitle>
          <div className="flex items-center gap-4">
            <Slider
              min={1}
              max={20}
              step={0.1}
              value={[painting.guidanceScale ?? 4.5]}
              onValueChange={(values) => updatePaintingState({ guidanceScale: values[0] })}
            />
            <Input
              className="w-[70px]"
              type="number"
              min={1}
              max={20}
              step={0.1}
              value={String(painting.guidanceScale ?? 4.5)}
              onChange={(e) => updatePaintingState({ guidanceScale: Number(e.target.value) || 4.5 })}
            />
          </div>
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.negative_prompt')}
            <InfoTooltip content={t('paintings.negative_prompt_tip')} />
          </SettingTitle>
          <Textarea.Input
            value={painting.negativePrompt || ''}
            onValueChange={(value) => updatePaintingState({ negativePrompt: value })}
            spellCheck={false}
            rows={4}
          />
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.prompt_enhancement')}
            <InfoTooltip content={t('paintings.prompt_enhancement_tip')} />
          </SettingTitle>
          <RowFlex>
            <Switch
              checked={painting.promptEnhancement}
              onCheckedChange={(checked) => updatePaintingState({ promptEnhancement: checked })}
            />
          </RowFlex>
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
          />
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
          paintings={siliconflow_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={() => setPainting(addPaintingScoped(getNewPainting()))}
          onReorder={reorder}
        />
      </div>
    </div>
  )
}

export default SiliconPage
