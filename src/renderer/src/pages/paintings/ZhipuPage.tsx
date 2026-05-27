import { PlusOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { InputNumber, Radio, Select } from 'antd'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  IMAGE_SIZES,
  QUALITY_OPTIONS,
  TOP_UP_URL,
  ZHIPU_PAINTING_MODELS
} from './providers/zhipu/config'
import { generateZhipuImages } from './providers/zhipu/provider'
import { checkProviderEnabled } from './utils'
import { savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('ZhipuPage')

const ZhipuPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { zhipu_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<any>(zhipu_paintings?.[0] || DEFAULT_PAINTING)
  const { t } = useTranslation()
  const providers = useAllProviders()

  // 确保painting使用智谱的cogview系列模型
  useEffect(() => {
    if (painting && !painting.model?.startsWith('cogview')) {
      const updatedPainting = { ...painting, model: 'cogview-3-flash' }
      setPainting(updatedPainting)
      updatePainting('zhipu_paintings', updatedPainting)
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
  const textareaRef = useRef<any>(null)

  // 自定义尺寸相关状态
  const [isCustomSize, setIsCustomSize] = useState(false)
  const [customWidth, setCustomWidth] = useState<number | undefined>()
  const [customHeight, setCustomHeight] = useState<number | undefined>()

  const updatePaintingState = (updates: Partial<any>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('zhipu_paintings', updatedPainting)
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
        signal: controller.signal
      })

      const savedResult = await savePaintingGenerationResult(result)
      if (savedResult) {
        updatePaintingState({
          files: savedResult.files,
          urls: savedResult.urls
        })
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

    await removePainting('zhipu_paintings', paintingToDelete)

    if (!zhipu_paintings || zhipu_paintings.length === 1) {
      const newPainting = getNewPainting()
      const addedPainting = addPainting('zhipu_paintings', newPainting)
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
    const addedPainting = addPainting('zhipu_paintings', newPainting)
    setPainting(addedPainting)
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
        <Scrollbar className="flex h-full max-w-(--assistants-width) flex-1 flex-col bg-background p-5 [border-right:0.5px_solid_var(--color-border)]">
          <div className="mb-2.5 flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
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

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('common.model')}</SettingTitle>
          <Select
            value={painting.model}
            onChange={onSelectModel}
            style={{ width: '100%' }}
            options={ZHIPU_PAINTING_MODELS.map((model) => ({
              label: model.name,
              value: model.id
            }))}
          />

          {painting.model === 'cogview-4-250304' && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.quality')}</SettingTitle>
              <Radio.Group value={painting.quality} onChange={(e) => onSelectQuality(e.target.value)}>
                {QUALITY_OPTIONS.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    {t(option.label)}
                  </Radio>
                ))}
              </Radio.Group>
            </>
          )}

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
          <Select
            value={isCustomSize ? 'custom' : painting.imageSize}
            onChange={onSelectImageSize}
            style={{ width: '100%' }}>
            {IMAGE_SIZES.map((size) => (
              <Select.Option key={size.value} value={size.value}>
                {t(size.label)}
              </Select.Option>
            ))}
            <Select.Option value="custom" key="custom">
              {t('paintings.custom_size')}
            </Select.Option>
          </Select>

          {/* 自定义尺寸输入框 */}
          {isCustomSize && (
            <div style={{ marginTop: 10 }}>
              <RowFlex className="items-center gap-2">
                <InputNumber
                  placeholder="W"
                  value={customWidth}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'width')}
                  min={512}
                  max={2048}
                  style={{ width: 80, flex: 1 }}
                />
                <span style={{ color: 'var(--color-foreground-secondary)', fontSize: '12px' }}>x</span>
                <InputNumber
                  placeholder="H"
                  value={customHeight}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'height')}
                  min={512}
                  max={2048}
                  style={{ width: 80, flex: 1 }}
                />
                <span style={{ color: 'var(--color-foreground-secondary)', fontSize: '12px' }}>px</span>
              </RowFlex>
              <div style={{ marginTop: 5, fontSize: '12px', color: 'var(--color-foreground-muted)' }}>
                {t('paintings.zhipu.custom_size_hint')}
              </div>
            </div>
          )}
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-background">
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
          namespace="zhipu_paintings"
          paintings={zhipu_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      </div>
    </div>
  )
}

export default ZhipuPage
