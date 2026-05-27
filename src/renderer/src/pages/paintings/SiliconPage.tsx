import { RedoOutlined } from '@ant-design/icons'
import { ColFlex, InfoTooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, Painting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Input, InputNumber, Radio, Select, Slider } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import ImageUploader from './components/ImageUploader'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingImageNavigation } from './hooks/usePaintingImageNavigation'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import {
  DEFAULT_PAINTING,
  generateRandomSeed,
  getSiliconModelParams,
  TEXT_TO_IMAGES_MODELS
} from './providers/silicon/config'
import { generateSiliconImages, getSiliconInputImages } from './providers/silicon/provider'
import { checkProviderEnabled } from './utils'
import { savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('SiliconPage')

// let _painting: Painting

const SiliconPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { t } = useTranslation()
  const { siliconflow_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<Painting>(siliconflow_paintings[0] || DEFAULT_PAINTING)
  const { theme } = useTheme()
  const providers = useAllProviders()

  const siliconFlowProvider = providers.find((p) => p.id === 'silicon')!
  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(painting.files.length)

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

  const textareaRef = useRef<TextAreaRef>(null)
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

    if (!painting.model) {
      return
    }

    await runGeneration(async (signal) => {
      const inputImages = await getSiliconInputImages(fileMap.imageFiles.slice(0, modelParams.maxInputImages))
      const result = await generateSiliconImages({
        provider,
        painting,
        prompt,
        signal,
        inputImages,
        modelParams: {
          supportsImageSize: modelParams.supportsImageSize,
          supportsSteps: modelParams.supportsSteps,
          supportsGuidanceScale: modelParams.supportsGuidanceScale,
          supportsBatchSize: modelParams.supportsBatchSize,
          defaultImageSize: modelParams.imageSizes[0]?.value
        }
      })

      const savedResult = await savePaintingGenerationResult(result, {
        t,
        emptyUrlLogMessage: '图像URL为空，可能是提示词违禁',
        errorLogMessage: 'Failed to download image:'
      })

      if (savedResult) {
        updatePaintingState({
          files: savedResult.files,
          urls: savedResult.urls
        })
      }
    })
  }

  const onCancel = () => {
    cancelGeneration()
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

  const handleAddPainting = () => {
    const newPainting = addPainting('siliconflow_paintings', getNewPainting())
    setPainting(newPainting)
    return newPainting
  }

  const onSelectPainting = (newPainting: Painting) => {
    if (generating) return
    setPainting(newPainting)
    resetImageIndex()
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

  useEffect(() => {
    if (siliconflow_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('siliconflow_paintings', newPainting)
      setPainting(newPainting)
    }
  }, [siliconflow_paintings.length, addPainting])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          <SettingTitle className="mb-1.25">{t('common.provider')}</SettingTitle>
          <ProviderSelect provider={siliconFlowProvider} options={Options} onChange={handleProviderChange} />
          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <Select value={painting.model} options={modelOptions} onChange={onSelectModel} />
          {modelParams.maxInputImages > 0 && (
            <>
              <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.remix.image_file')}</SettingTitle>
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
              <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.image.size')}</SettingTitle>
              <Radio.Group
                value={painting.imageSize}
                onChange={(e) => onSelectImageSize(e.target.value)}
                className="flex!">
                {imageSizes.map((size) => (
                  <Radio.Button
                    value={size.value}
                    key={size.value}
                    className="flex! h-13.75! w-7.5! flex-1 flex-col items-center justify-center">
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
              <SettingTitle className="mt-3.75 mb-1.25">
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

          <SettingTitle className="mt-3.75 mb-1.25">
            {t('paintings.seed')}
            <InfoTooltip content={t('paintings.seed_tip')} />
          </SettingTitle>
          <Input
            value={painting.seed}
            onChange={(e) => updatePaintingState({ seed: e.target.value })}
            suffix={
              <RedoOutlined
                onClick={() => updatePaintingState({ seed: Math.floor(Math.random() * 1000000).toString() })}
                className="cursor-pointer text-foreground-secondary"
              />
            }
          />

          {modelParams.supportsSteps && (
            <>
              <SettingTitle className="mt-3.75 mb-1.25">
                {t('paintings.inference_steps')}
                <InfoTooltip content={t('paintings.inference_steps_tip')} />
              </SettingTitle>
              <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
                <Slider min={1} max={100} value={painting.steps} onChange={(v) => updatePaintingState({ steps: v })} />
                <InputNumber
                  className="w-17.5!"
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
              <SettingTitle className="mt-3.75 mb-1.25">
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
                  className="w-17.5!"
                  min={0}
                  max={20}
                  step={0.1}
                  value={painting.guidanceScale}
                  onChange={(v) => updatePaintingState({ guidanceScale: (v as number) || 7.5 })}
                />
              </div>
            </>
          )}
          <SettingTitle className="mt-3.75 mb-1.25">
            {t('paintings.negative_prompt')}
            <InfoTooltip content={t('paintings.negative_prompt_tip')} />
          </SettingTitle>
          <TextArea
            value={painting.negativePrompt}
            onChange={(e) => updatePaintingState({ negativePrompt: e.target.value })}
            spellCheck={false}
            rows={4}
          />
        </>
      }
      artboard={
        <Artboard
          painting={painting}
          isLoading={isLoading}
          currentImageIndex={currentImageIndex}
          onPrevImage={prevImage}
          onNextImage={nextImage}
          onCancel={onCancel}
        />
      }
      promptBar={
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
      }
      history={
        <PaintingsList
          namespace="siliconflow_paintings"
          paintings={siliconflow_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      }
    />
  )
}

export default SiliconPage
