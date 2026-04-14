import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Input,
  RadioGroup,
  RadioGroupItem,
  RowFlex,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { AiProvider } from '@renderer/aiCore'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  IMAGE_SIZES,
  QUALITY_OPTIONS,
  TOP_UP_URL,
  ZHIPU_PAINTING_MODELS
} from './config/ZhipuConfig'
import { checkProviderEnabled } from './utils'

const ZhipuPage: FC<{ Options: string[] }> = ({ Options }) => {
  const {
    items: zhipu_paintings,
    add: addPaintingScoped,
    remove: removePaintingScoped,
    update: updatePaintingScoped,
    reorder
  } = usePaintingList({ providerId: 'zhipu', mode: 'generate' })
  const [painting, setPainting] = useState<any>(zhipu_paintings?.[0] || DEFAULT_PAINTING)
  const { t } = useTranslation()
  const providers = useAllProviders()

  // 确保painting使用智谱的cogview系列模型
  useEffect(() => {
    if (painting && !painting.model?.startsWith('cogview')) {
      const updatedPainting = { ...painting, model: 'cogview-3-flash' }
      setPainting(updatedPainting)
      updatePaintingScoped(updatedPainting)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting?.id]) // 只在painting的id改变时执行，避免无限循环

  const zhipuProvider = providers.find((p) => p.id === 'zhipu')!

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')
  const navigate = useNavigate()
  const location = useLocation()

  // 自定义尺寸相关状态
  const [isCustomSize, setIsCustomSize] = useState(false)
  const [customWidth, setCustomWidth] = useState<number | undefined>()
  const [customHeight, setCustomHeight] = useState<number | undefined>()

  const updatePaintingState = (updates: Partial<any>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePaintingScoped(updatedPainting)
  }

  const getNewPainting = (params?: Partial<any>) => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      ...params
    }
  }

  const onGenerate = async () => {
    await checkProviderEnabled(zhipuProvider, t)

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
      await FileManager.deleteFiles(painting.files)
    }

    setIsLoading(true)
    setGenerating(true)
    const controller = new AbortController()
    setAbortController(controller)

    try {
      // 使用AiProvider调用智谱AI绘图API
      const aiProvider = new AiProvider(zhipuProvider)

      // 准备API请求参数
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

      const request = {
        model: painting.model,
        prompt: painting.prompt,
        negativePrompt: painting.negativePrompt,
        imageSize: actualImageSize,
        batchSize: painting.numImages,
        quality: painting.quality,
        signal: controller.signal
      }

      // NOTE: ai sdk内部已经处理成了base64
      const images = await aiProvider.generateImage(request)

      // 下载图片到本地文件
      if (images.length > 0) {
        const downloadedFiles = await Promise.all(
          images.map(async (image) => {
            try {
              return await window.api.file.saveBase64Image(image)
            } catch (error) {
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

        const validFiles = downloadedFiles.filter((file): file is any => file !== null)

        await FileManager.addFiles(validFiles)

        // 处理响应结果
        const newPainting = {
          ...painting,
          files: validFiles
        }

        updatePaintingState(newPainting)
      }
    } catch (error) {
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
    if (abortController) {
      abortController.abort()
    }
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const onDeletePainting = async (paintingToDelete: any) => {
    if (paintingToDelete.id === painting.id) {
      if (isLoading) return

      const currentIndex = zhipu_paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(zhipu_paintings[currentIndex - 1])
      } else if (zhipu_paintings.length > 1) {
        setPainting(zhipu_paintings[1])
      }
    }

    await removePaintingScoped(paintingToDelete)

    if (!zhipu_paintings || zhipu_paintings.length === 1) {
      const newPainting = getNewPainting()
      const addedPainting = addPaintingScoped(newPainting)
      setPainting(addedPainting)
    }
  }

  const onSelectPainting = (newPainting: any) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
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
    const addedPainting = addPaintingScoped(newPainting)
    setPainting(addedPainting)
  }

  useEffect(() => {
    if (!zhipu_paintings || zhipu_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPaintingScoped(newPainting)
    }
  }, [zhipu_paintings, addPaintingScoped])

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
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight>
            <Button size="sm" className="nodrag" variant="ghost" onClick={handleAddPainting}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex flex-1 overflow-hidden">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] p-5">
          <div className="mb-[10px] flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <div>
              <SettingHelpLink target="_blank" href={TOP_UP_URL}>
                {t('paintings.top_up')}
              </SettingHelpLink>
              <SettingHelpLink target="_blank" href={COURSE_URL}>
                {t('paintings.paint_course')}
              </SettingHelpLink>
              {(() => {
                const Icon = resolveProviderIcon(zhipuProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null
              })()}
            </div>
          </div>
          <ProviderSelect provider={zhipuProvider} options={Options} onChange={handleProviderChange} className="mb-4" />

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('common.model')}</SettingTitle>
          <Select value={painting.model} onValueChange={onSelectModel}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('common.model')} />
            </SelectTrigger>
            <SelectContent>
              {ZHIPU_PAINTING_MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {painting.model === 'cogview-4-250304' && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.quality')}</SettingTitle>
              <RadioGroup value={painting.quality} className="flex flex-col gap-2" onValueChange={onSelectQuality}>
                {QUALITY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    htmlFor={`zhipu-quality-${option.value}`}
                    className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem id={`zhipu-quality-${option.value}`} value={option.value} />
                    <span>{t(option.label)}</span>
                  </label>
                ))}
              </RadioGroup>
            </>
          )}

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
          <Select value={isCustomSize ? 'custom' : painting.imageSize} onValueChange={onSelectImageSize}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('paintings.image.size')} />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_SIZES.map((size) => (
                <SelectItem key={size.value} value={size.value}>
                  {t(size.label)}
                </SelectItem>
              ))}
              <SelectItem value="custom">{t('paintings.custom_size')}</SelectItem>
            </SelectContent>
          </Select>

          {/* 自定义尺寸输入框 */}
          {isCustomSize && (
            <div className="mt-2.5">
              <RowFlex className="items-center gap-2">
                <Input
                  placeholder="W"
                  type="number"
                  value={customWidth === undefined ? '' : String(customWidth)}
                  onChange={(e) => onCustomSizeChange(e.target.value ? Number(e.target.value) : undefined, 'width')}
                  min={512}
                  max={2048}
                  className="flex-1"
                />
                <span className="text-[12px] text-[var(--color-text-2)]">x</span>
                <Input
                  placeholder="H"
                  type="number"
                  value={customHeight === undefined ? '' : String(customHeight)}
                  onChange={(e) => onCustomSizeChange(e.target.value ? Number(e.target.value) : undefined, 'height')}
                  min={512}
                  max={2048}
                  className="flex-1"
                />
                <span className="text-[12px] text-[var(--color-text-2)]">px</span>
              </RowFlex>
              <div className="mt-1 text-[12px] text-[var(--color-text-3)]">{t('paintings.zhipu.custom_size_hint')}</div>
            </div>
          )}
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
            placeholder={t('paintings.prompt_placeholder')}
            onPromptChange={(value) => updatePaintingState({ prompt: value })}
            onGenerate={onGenerate}
          />
        </div>
        <PaintingsList
          paintings={zhipu_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
          onReorder={reorder}
        />
      </div>
    </div>
  )
}

export default ZhipuPage
