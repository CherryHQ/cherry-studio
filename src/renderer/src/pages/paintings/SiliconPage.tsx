import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { Button, ColFlex, InfoTooltip } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ImageSize1_1 from '@renderer/assets/images/paintings/image-size-1-1.svg'
import ImageSize1_2 from '@renderer/assets/images/paintings/image-size-1-2.svg'
import ImageSize3_2 from '@renderer/assets/images/paintings/image-size-3-2.svg'
import ImageSize3_4 from '@renderer/assets/images/paintings/image-size-3-4.svg'
import ImageSize9_16 from '@renderer/assets/images/paintings/image-size-9-16.svg'
import ImageSize16_9 from '@renderer/assets/images/paintings/image-size-16-9.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, Painting, Provider } from '@renderer/types'
import { convertToBase64, getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Input, InputNumber, Radio, Select, Slider } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import ImageUploader from './components/ImageUploader'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { checkProviderEnabled } from './utils'
import { saveGeneratedPaintingFiles } from './utils/imageFiles'

export const TEXT_TO_IMAGES_MODELS = [
  {
    id: 'Tongyi-MAI/Z-Image-Turbo',
    provider: 'silicon',
    name: 'Z-Image-Turbo',
    group: 'Tongyi-MAI'
  },
  {
    id: 'Tongyi-MAI/Z-Image',
    provider: 'silicon',
    name: 'Z-Image',
    group: 'Tongyi-MAI'
  },
  {
    id: 'baidu/ERNIE-Image-Turbo',
    provider: 'silicon',
    name: 'ERNIE-Image-Turbo',
    group: 'baidu'
  },
  {
    id: 'Qwen/Qwen-Image-Edit-2509',
    provider: 'silicon',
    name: 'Qwen-Image-Edit-2509',
    group: 'qwen'
  },
  {
    id: 'Qwen/Qwen-Image-Edit',
    provider: 'silicon',
    name: 'Qwen-Image-Edit',
    group: 'qwen'
  },
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

const KOLORS_IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '3:2', value: '1536x1024', icon: ImageSize3_2 },
  { label: '16:9', value: '2048x1152', icon: ImageSize16_9 },
  { label: '3:4', value: '1536x2048', icon: ImageSize3_4 },
  { label: '9:16', value: '1152x2048', icon: ImageSize9_16 },
  { label: '1:2', value: '1024x2048', icon: ImageSize1_2 }
]

const QWEN_IMAGE_SIZES = [
  { label: '1:1', value: '1328x1328', icon: ImageSize1_1 },
  { label: '3:2', value: '1584x1056', icon: ImageSize3_2 },
  { label: '16:9', value: '1664x928', icon: ImageSize16_9 },
  { label: '3:4', value: '1140x1472', icon: ImageSize3_4 },
  { label: '9:16', value: '928x1664', icon: ImageSize9_16 }
]

const Z_IMAGE_SIZES = [
  { label: '1:1', value: '1024x1024', icon: ImageSize1_1 },
  { label: '4:3', value: '1200x896', icon: ImageSize3_4 },
  { label: '3:2', value: '1264x848', icon: ImageSize3_2 },
  { label: '16:9', value: '1376x768', icon: ImageSize16_9 },
  { label: '3:4', value: '896x1200', icon: ImageSize3_4 },
  { label: '9:16', value: '768x1376', icon: ImageSize9_16 }
]

const SILICON_MODEL_PARAMS = {
  'Tongyi-MAI/Z-Image-Turbo': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: false,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Tongyi-MAI/Z-Image': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: true,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'baidu/ERNIE-Image-Turbo': {
    imageSizes: Z_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: false,
    supportsGuidanceScale: true,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Qwen/Qwen-Image-Edit-2509': {
    imageSizes: [],
    supportsImageSize: false,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 3,
    requiresInputImage: true
  },
  'Qwen/Qwen-Image-Edit': {
    imageSizes: [],
    supportsImageSize: false,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 1,
    requiresInputImage: true
  },
  'Qwen/Qwen-Image': {
    imageSizes: QWEN_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: false,
    supportsBatchSize: false,
    maxInputImages: 0,
    requiresInputImage: false
  },
  'Kwai-Kolors/Kolors': {
    imageSizes: KOLORS_IMAGE_SIZES,
    supportsImageSize: true,
    supportsSteps: true,
    supportsGuidanceScale: true,
    supportsBatchSize: true,
    maxInputImages: 1,
    requiresInputImage: false
  }
}

const getSiliconModelParams = (model?: string) =>
  SILICON_MODEL_PARAMS[model as keyof typeof SILICON_MODEL_PARAMS] || SILICON_MODEL_PARAMS['Kwai-Kolors/Kolors']

type SiliconImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  images?: Array<{ url?: string; b64_json?: string }>
}

const getSiliconImageEndpoint = (provider: Provider) => {
  const apiHost = provider.apiHost.replace(/\/$/, '').replace(/\/v1$/, '')
  return `${apiHost}/v1/images/generations`
}

const parseSiliconImageUrls = (data: SiliconImageResponse) => {
  const images = data.data || data.images || []
  return images
    .map((image) => image.url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined))
    .filter((url): url is string => Boolean(url))
}

const getSiliconInputImages = async (files: FileMetadata[]) => {
  const images = await Promise.all(files.map((file) => convertToBase64(file as unknown as File)))
  return images.filter((image): image is string => typeof image === 'string')
}

const generateSiliconImages = async (
  provider: Provider,
  painting: Painting,
  prompt: string,
  signal: AbortSignal,
  inputImages: string[]
) => {
  const modelParams = getSiliconModelParams(painting.model)
  const response = await fetch(getSiliconImageEndpoint(provider), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: painting.model,
      prompt,
      negative_prompt: painting.negativePrompt || undefined,
      image_size: modelParams.supportsImageSize ? painting.imageSize || modelParams.imageSizes[0].value : undefined,
      batch_size: modelParams.supportsBatchSize ? painting.numImages || 1 : undefined,
      seed: painting.seed ? Number(painting.seed) : undefined,
      num_inference_steps: modelParams.supportsSteps ? painting.steps || 20 : undefined,
      guidance_scale: modelParams.supportsGuidanceScale ? painting.guidanceScale || 7.5 : undefined,
      image: inputImages[0],
      image2: inputImages[1],
      image3: inputImages[2]
    }),
    signal
  })

  const data = (await response.json()) as SiliconImageResponse & { error?: { message?: string } }

  if (!response.ok) {
    throw new Error(data.error?.message || response.statusText)
  }

  return parseSiliconImageUrls(data)
}

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
  const { siliconflow_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<Painting>(siliconflow_paintings[0] || DEFAULT_PAINTING)
  const { theme } = useTheme()
  const providers = useAllProviders()

  const siliconFlowProvider = providers.find((p) => p.id === 'silicon')!
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')
  const [fileMap, setFileMap] = useState<{ imageFiles: FileMetadata[]; paths: string[] }>({
    imageFiles: [],
    paths: []
  })
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
  const modelParams = getSiliconModelParams(painting.model)
  const imageSizes = modelParams.imageSizes

  const textareaRef = useRef<any>(null)
  // _painting = painting

  const updatePaintingState = (updates: Partial<Painting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('siliconflow_paintings', updatedPainting)
  }

  const onSelectModel = (modelId: string) => {
    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === modelId)
    if (model) {
      const nextModelParams = getSiliconModelParams(modelId)
      const nextImageSize = nextModelParams.imageSizes.some((size) => size.value === painting.imageSize)
        ? painting.imageSize
        : nextModelParams.imageSizes[0]?.value
      setFileMap((prevFileMap) => ({
        imageFiles: prevFileMap.imageFiles.slice(0, nextModelParams.maxInputImages),
        paths: prevFileMap.paths.slice(0, nextModelParams.maxInputImages)
      }))
      updatePaintingState({ model: modelId, imageSize: nextImageSize })
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

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''

    updatePaintingState({ prompt })

    const provider = siliconFlowProvider

    if (!provider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    const modelParams = getSiliconModelParams(painting.model)
    if (modelParams.requiresInputImage && fileMap.imageFiles.length === 0) {
      window.modal.error({
        content: t('paintings.image_file_required'),
        centered: true
      })
      return
    }

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    setGenerating(true)
    if (!painting.model) {
      return
    }

    try {
      const inputImages = await getSiliconInputImages(fileMap.imageFiles.slice(0, modelParams.maxInputImages))
      const urls = await generateSiliconImages(provider, painting, prompt, controller.signal, inputImages)

      if (urls.length > 0) {
        const validFiles = await saveGeneratedPaintingFiles({
          urls,
          t,
          emptyUrlLogMessage: '图像URL为空，可能是提示词违禁',
          errorLogMessage: 'Failed to download image:'
        })
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
    const size = imageSizes.find((i) => i.value === v)
    size && updatePaintingState({ imageSize: size.value })
  }

  const onAddImage = (file: File, index?: number) => {
    const path = URL.createObjectURL(file)

    setFileMap((prevFileMap) => {
      const imageFiles = [...prevFileMap.imageFiles]
      const paths = [...prevFileMap.paths]

      if (index !== undefined) {
        imageFiles[index] = file as unknown as FileMetadata
        paths[index] = path
      } else {
        imageFiles.push(file as unknown as FileMetadata)
        paths.push(path)
      }

      return { imageFiles, paths }
    })
  }

  const clearImages = () => {
    setFileMap({ imageFiles: [], paths: [] })
  }

  const handleDeleteImage = (index: number) => {
    setFileMap((prevFileMap) => {
      const imageFiles = [...prevFileMap.imageFiles]
      const paths = [...prevFileMap.paths]
      imageFiles.splice(index, 1)
      paths.splice(index, 1)
      return { imageFiles, paths }
    })
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

    void removePainting('siliconflow_paintings', paintingToDelete)
  }

  const onSelectPainting = (newPainting: Painting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    enabled: autoTranslateWithSpace,
    onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  useEffect(() => {
    if (siliconflow_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('siliconflow_paintings', newPainting)
      setPainting(newPainting)
    }
  }, [siliconflow_paintings.length, addPainting])

  return (
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button
              size="sm"
              className="nodrag"
              onClick={() => setPainting(addPainting('siliconflow_paintings', getNewPainting()))}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-[var(--color-background)]">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col bg-[var(--color-background)] p-5 [border-right:0.5px_solid_var(--color-border)]">
          <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
          <ProviderSelect provider={siliconFlowProvider} options={Options} onChange={handleProviderChange} />
          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <Select value={painting.model} options={modelOptions} onChange={onSelectModel} />
          {modelParams.maxInputImages > 0 && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.remix.image_file')}</SettingTitle>
              <ImageUploader
                fileMap={fileMap}
                maxImages={modelParams.maxInputImages}
                onClearImages={clearImages}
                onDeleteImage={handleDeleteImage}
                onAddImage={onAddImage}
                mode="silicon"
              />
            </>
          )}
          {modelParams.supportsImageSize && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
              <Radio.Group
                value={painting.imageSize}
                onChange={(e) => onSelectImageSize(e.target.value)}
                style={{ display: 'flex' }}>
                {imageSizes.map((size) => (
                  <Radio.Button
                    value={size.value}
                    key={size.value}
                    className="!flex !h-[55px] !w-[30px] flex-1 flex-col items-center justify-center">
                    <ColFlex className="items-center">
                      <img src={size.icon} alt="" className={theme === 'dark' ? 'mt-2 invert' : 'mt-2'} />
                      <span>{size.label}</span>
                    </ColFlex>
                  </Radio.Button>
                ))}
              </Radio.Group>
            </>
          )}

          {modelParams.supportsBatchSize && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
                {t('paintings.number_images')}
                <InfoTooltip content={t('paintings.number_images_tip')} />
              </SettingTitle>
              <InputNumber
                min={1}
                max={4}
                value={painting.numImages}
                onChange={(v) => updatePaintingState({ numImages: v || 1 })}
              />
            </>
          )}

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.seed')}
            <InfoTooltip content={t('paintings.seed_tip')} />
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

          {modelParams.supportsSteps && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
                {t('paintings.inference_steps')}
                <InfoTooltip content={t('paintings.inference_steps_tip')} />
              </SettingTitle>
              <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
                <Slider min={1} max={100} value={painting.steps} onChange={(v) => updatePaintingState({ steps: v })} />
                <InputNumber
                  className="!w-[70px]"
                  min={1}
                  max={100}
                  value={painting.steps}
                  onChange={(v) => updatePaintingState({ steps: (v as number) || 20 })}
                />
              </div>
            </>
          )}

          {modelParams.supportsGuidanceScale && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
                {t('paintings.guidance_scale')}
                <InfoTooltip content={t('paintings.guidance_scale_tip')} />
              </SettingTitle>
              <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
                <Slider
                  min={0}
                  max={20}
                  step={0.1}
                  value={painting.guidanceScale}
                  onChange={(v) => updatePaintingState({ guidanceScale: v })}
                />
                <InputNumber
                  className="!w-[70px]"
                  min={0}
                  max={20}
                  step={0.1}
                  value={painting.guidanceScale}
                  onChange={(v) => updatePaintingState({ guidanceScale: (v as number) || 7.5 })}
                />
              </div>
            </>
          )}
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.negative_prompt')}
            <InfoTooltip content={t('paintings.negative_prompt_tip')} />
          </SettingTitle>
          <TextArea
            value={painting.negativePrompt}
            onChange={(e) => updatePaintingState({ negativePrompt: e.target.value })}
            spellCheck={false}
            rows={4}
          />
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
            textareaRef={textareaRef}
            value={painting.prompt}
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
        </div>
        <PaintingsList
          namespace="siliconflow_paintings"
          paintings={siliconflow_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={() => setPainting(addPainting('siliconflow_paintings', getNewPainting()))}
        />
      </div>
    </div>
  )
}

export default SiliconPage
