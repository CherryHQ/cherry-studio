import { RadioGroup, RadioGroupItem, RowFlex } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import type { Painting, PaintingAction } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { NumberField } from './components/PaintingControls'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingSelect from './components/PaintingSelect'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingImageNavigation } from './hooks/usePaintingImageNavigation'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { usePaintingProvider } from './hooks/usePaintingProvider'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  IMAGE_SIZES,
  QUALITY_OPTIONS,
  TOP_UP_URL,
  ZHIPU_PAINTING_MODELS,
  ZHIPU_QUALITY_MODELS
} from './providers/zhipu/config'
import { generateZhipuImages } from './providers/zhipu/provider'
import { checkProviderEnabled } from './utils'
import { savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('ZhipuPage')

type ZhipuPainting = Painting & {
  model: string
  prompt: string
  imageSize: string
  numImages: number
  quality?: string
  customWidth?: number
  customHeight?: number
}

function toZhipuPainting(painting?: Partial<ZhipuPainting> | PaintingAction): ZhipuPainting {
  return {
    ...DEFAULT_PAINTING,
    ...painting
  }
}

const ZhipuPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { zhipu_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<ZhipuPainting>(() => toZhipuPainting(zhipu_paintings?.[0]))
  const { t } = useTranslation()

  // 确保 painting 使用智谱绘图支持的模型
  useEffect(() => {
    if (painting && !ZHIPU_PAINTING_MODELS.some((model) => model.id === painting.model)) {
      const updatedPainting = { ...painting, model: 'cogview-3-flash' }
      setPainting(updatedPainting)
      updatePainting('zhipu_paintings', updatedPainting)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting?.id]) // 只在painting的id改变时执行，避免无限循环

  const { provider: zhipuProvider } = usePaintingProvider('zhipu')

  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(painting.files.length)
  const navigate = useNavigate()
  const location = useLocation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自定义尺寸相关状态
  const [isCustomSize, setIsCustomSize] = useState(false)
  const [customWidth, setCustomWidth] = useState<number | undefined>()
  const [customHeight, setCustomHeight] = useState<number | undefined>()

  const updatePaintingState = (updates: Partial<ZhipuPainting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('zhipu_paintings', updatedPainting)
  }

  const getNewPainting = (params?: Partial<ZhipuPainting>): ZhipuPainting => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      ...params
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
    await checkProviderEnabled(zhipuProvider, t, (providerId) =>
      navigate({ to: '/settings/provider', search: { id: providerId } })
    )

    if (isLoading) return

    if (!painting.prompt.trim()) {
      window.modal.error({
        content: t('paintings.prompt_required'),
        centered: true
      })
      return
    }

    // 检查是否需要重新生成（如果已有图片）
    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
    }

    await runGeneration(async (signal) => {
      let actualImageSize = painting.imageSize

      // 如果是自定义尺寸，使用实际的宽高值
      if (painting.imageSize === 'custom') {
        if (!customWidth || !customHeight) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_required'),
            centered: true
          })
          return
        }
        // 验证自定义尺寸是否符合智谱AI的要求
        if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_range'),
            centered: true
          })
          return
        }

        if (customWidth % 16 !== 0 || customHeight % 16 !== 0) {
          window.modal.error({
            content: t('paintings.zhipu.custom_size_divisible'),
            centered: true
          })
          return
        }

        const totalPixels = customWidth * customHeight
        if (totalPixels > 2097152) {
          // 2^21 = 2097152
          window.modal.error({
            content: t('paintings.zhipu.custom_size_pixels'),
            centered: true
          })
          return
        }

        actualImageSize = `${customWidth}x${customHeight}`
      }

      // NOTE: ai sdk内部已经处理成了base64
      const result = await generateZhipuImages({
        provider: zhipuProvider,
        painting,
        imageSize: actualImageSize,
        signal
      })

      const savedResult = await savePaintingGenerationResult(result)
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

  const onDeletePainting = async (paintingToDelete: Painting) => {
    if (paintingToDelete.id === painting.id) {
      if (isLoading) return

      const currentIndex = zhipu_paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(toZhipuPainting(zhipu_paintings[currentIndex - 1]))
      } else if (zhipu_paintings.length > 1) {
        setPainting(toZhipuPainting(zhipu_paintings[1]))
      }
    }

    await removePainting('zhipu_paintings', paintingToDelete)

    if (!zhipu_paintings || zhipu_paintings.length === 1) {
      const newPainting = getNewPainting()
      const addedPainting = addPainting('zhipu_paintings', newPainting)
      setPainting(toZhipuPainting(addedPainting))
    }
  }

  const onSelectPainting = (newPainting: Painting) => {
    if (generating) return
    setPainting(toZhipuPainting(newPainting))
    resetImageIndex()
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  const onSelectModel = (modelId: string) => {
    updatePaintingState({ model: modelId })
  }

  const onSelectQuality = (quality: string) => {
    updatePaintingState({ quality })
  }

  const onSelectImageSize = (size: string) => {
    if (size === 'custom') {
      setIsCustomSize(true)
      updatePaintingState({ imageSize: 'custom' })
    } else {
      setIsCustomSize(false)
      updatePaintingState({ imageSize: size })
    }
  }

  const onCustomSizeChange = (value: number | undefined, dimension: 'width' | 'height') => {
    if (dimension === 'width') {
      setCustomWidth(value)
      updatePaintingState({ customWidth: value })
    } else {
      setCustomHeight(value)
      updatePaintingState({ customHeight: value })
    }
  }

  const handleAddPainting = () => {
    if (generating) return
    const newPainting = getNewPainting()
    const addedPainting = addPainting('zhipu_paintings', newPainting)
    setPainting(toZhipuPainting(addedPainting))
  }

  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  // 移除modelOptions的定义，直接在Select中使用

  useEffect(() => {
    if (!zhipu_paintings || zhipu_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('zhipu_paintings', newPainting)
    }
  }, [zhipu_paintings, addPainting])

  // 同步自定义尺寸状态
  useEffect(() => {
    if (painting.imageSize === 'custom') {
      setIsCustomSize(true)
      // 恢复自定义尺寸的宽高值
      if (painting.customWidth) {
        setCustomWidth(painting.customWidth)
      }
      if (painting.customHeight) {
        setCustomHeight(painting.customHeight)
      }
    } else {
      setIsCustomSize(false)
    }
  }, [painting.imageSize, painting.customWidth, painting.customHeight])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      addButtonVariant="ghost"
      contentClassName="flex flex-1 overflow-hidden"
      settings={
        <>
          <div className="mb-2.5 flex items-center justify-between">
            <SettingTitle className="mb-1.25">{t('common.provider')}</SettingTitle>
            <div className="flex flex-row items-center gap-2">
              <SettingHelpLink target="_blank" href={TOP_UP_URL}>
                {t('paintings.top_up')}
              </SettingHelpLink>
              <SettingHelpLink target="_blank" href={COURSE_URL}>
                {t('paintings.paint_course')}
              </SettingHelpLink>
              {(() => {
                const Icon = resolveProviderIcon(zhipuProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null
              })()}
            </div>
          </div>
          <ProviderSelect provider={zhipuProvider} options={Options} onChange={handleProviderChange} className="mb-4" />

          <SettingTitle className="mt-3.75 mb-1.25">{t('common.model')}</SettingTitle>
          <PaintingSelect
            value={painting.model}
            onChange={onSelectModel}
            className="w-full"
            options={ZHIPU_PAINTING_MODELS.map((model) => ({
              label: model.name,
              value: model.id
            }))}
          />

          {ZHIPU_QUALITY_MODELS.includes(painting.model) && (
            <>
              <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.quality')}</SettingTitle>
              <RadioGroup value={painting.quality} onValueChange={onSelectQuality} className="flex gap-3">
                {QUALITY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value={option.value} />
                    {t(option.label)}
                  </label>
                ))}
              </RadioGroup>
            </>
          )}

          <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.image.size')}</SettingTitle>
          <PaintingSelect
            value={isCustomSize ? 'custom' : painting.imageSize}
            onChange={onSelectImageSize}
            className="w-full">
            {IMAGE_SIZES.map((size) => (
              <PaintingSelect.Option key={size.value} value={size.value}>
                {t(size.label)}
              </PaintingSelect.Option>
            ))}
            <PaintingSelect.Option value="custom" key="custom">
              {t('paintings.custom_size')}
            </PaintingSelect.Option>
          </PaintingSelect>

          {/* 自定义尺寸输入框 */}
          {isCustomSize && (
            <div className="mt-2.5">
              <RowFlex className="items-center gap-2">
                <NumberField
                  placeholder="W"
                  value={customWidth}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'width')}
                  min={512}
                  max={2048}
                  className="w-20 flex-1"
                />
                <span className="text-foreground-secondary text-xs">x</span>
                <NumberField
                  placeholder="H"
                  value={customHeight}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'height')}
                  min={512}
                  max={2048}
                  className="w-20 flex-1"
                />
                <span className="text-foreground-secondary text-xs">px</span>
              </RowFlex>
              <div className="mt-1.25 text-foreground-muted text-xs">{t('paintings.zhipu.custom_size_hint')}</div>
            </div>
          )}
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
          namespace="zhipu_paintings"
          paintings={zhipu_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      }
    />
  )
}

export default ZhipuPage
