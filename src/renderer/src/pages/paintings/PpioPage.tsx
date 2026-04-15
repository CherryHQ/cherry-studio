import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Select as UiSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip as UiTooltip
} from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { loggerService } from '@logger'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, PpioPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useNavigate } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { PaintingConfigFieldRenderer } from './components/PaintingConfigFieldRenderer'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import {
  createModeConfigs,
  DEFAULT_PPIO_PAINTING,
  getModelsByMode,
  type PpioConfigItem,
  type PpioMode
} from './config/ppioConfig'
import { checkProviderEnabled } from './utils'
import PpioService from './utils/PpioService'

const logger = loggerService.withContext('PpioPage')

// 使用函数创建配置项
const modeConfigs = createModeConfigs()

const PpioPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [mode, setMode] = useState<PpioMode>('ppio_draw')

  const ppioDbMode = mode === 'ppio_draw' ? 'draw' : 'edit'
  const {
    items: filteredPaintings,
    add: addPaintingScoped,
    remove: removePaintingScoped,
    update: updatePaintingScoped,
    reorder
  } = usePaintingList({ providerId: 'ppio', mode: ppioDbMode })

  const getDefaultPainting = useCallback((currentMode: PpioMode): PpioPainting => {
    const models = getModelsByMode(currentMode)
    return {
      ...DEFAULT_PPIO_PAINTING,
      model: models[0]?.id || DEFAULT_PPIO_PAINTING.model,
      id: uuid()
    }
  }, [])

  const [painting, setPainting] = useState<PpioPainting>(filteredPaintings[0] || getDefaultPainting(mode))

  const providers = useAllProviders()
  const ppioProvider = providers.find((p) => p.id === 'ppio')

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)

  const [, setGenerating] = useCache('chat.generating')
  const navigate = useNavigate()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  // 模式选项
  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'ppio_draw' },
    { label: t('paintings.mode.edit'), value: 'ppio_edit' }
  ]

  // 获取当前模式的模型选项
  const modelOptions = useMemo(() => {
    const models = getModelsByMode(mode)
    // 按组分组
    const groups: Record<string, Array<{ label: string; value: string }>> = {}
    models.forEach((m) => {
      if (!groups[m.group]) {
        groups[m.group] = []
      }
      groups[m.group].push({ label: m.name, value: m.id })
    })

    return Object.entries(groups).map(([group, options]) => ({
      label: group,
      options
    }))
  }, [mode])

  const getNewPainting = useCallback((): PpioPainting => {
    return getDefaultPainting(mode)
  }, [mode, getDefaultPainting])

  const updatePaintingState = useCallback(
    (updates: Partial<PpioPainting>) => {
      const updatedPainting = { ...painting, ...updates }
      setPainting(updatedPainting)
      updatePaintingScoped(updatedPainting)
    },
    [painting, updatePaintingScoped]
  )

  const onSelectModel = (modelId: string) => {
    updatePaintingState({ model: modelId })
  }

  const onSelectPainting = (selectedPainting: PpioPainting) => {
    setPainting(selectedPainting)
    setCurrentImageIndex(0)
  }

  const onDeletePainting = async (paintingToDelete: PpioPainting) => {
    await removePaintingScoped(paintingToDelete)
    if (painting.id === paintingToDelete.id) {
      const remainingPaintings = filteredPaintings.filter((p) => p.id !== paintingToDelete.id)
      if (remainingPaintings.length > 0) {
        setPainting(remainingPaintings[0])
      } else {
        const newPainting = getNewPainting()
        addPaintingScoped(newPainting)
        setPainting(newPainting)
      }
    }
  }

  const prevImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1)
    }
  }

  const nextImage = () => {
    if (painting.files && currentImageIndex < painting.files.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1)
    }
  }

  const onCancel = () => {
    if (abortController) {
      abortController.abort()
      setAbortController(null)
    }
    setIsLoading(false)
    setGenerating(false)
  }

  const handleProviderChange = (providerId: string) => {
    void navigate({ to: '../' + providerId, replace: true })
  }

  const handleModeChange = (value: string) => {
    const newMode = value as PpioMode
    setMode(newMode)
    setPainting(getDefaultPainting(newMode))
  }

  const onGenerate = async () => {
    if (!ppioProvider) {
      window.modal.error({
        content: t('error.provider_not_found'),
        centered: true
      })
      return
    }

    await checkProviderEnabled(ppioProvider, t)

    if (isLoading) return

    // Edit 模式需要图片
    if (mode === 'ppio_edit' && !painting.imageFile) {
      window.modal.error({
        content: t('paintings.edit.image_required'),
        centered: true
      })
      return
    }

    // 大部分模型需要 prompt（除了一些工具类模型）
    const noPromptModels = ['image-upscaler', 'image-remove-background', 'image-eraser']
    if (!noPromptModels.includes(painting.model || '') && !painting.prompt?.trim()) {
      window.modal.error({
        content: t('paintings.prompt_required'),
        centered: true
      })
      return
    }

    if (!ppioProvider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    // 检查是否需要重新生成
    if (painting.files && painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
    }

    setIsLoading(true)
    setGenerating(true)

    const controller = new AbortController()
    setAbortController(controller)

    try {
      const service = new PpioService(ppioProvider.apiKey)

      logger.info('Starting image generation', { model: painting.model, mode })

      const result = await service.generate(painting)

      let imageUrls: string[] = []

      if (result.images) {
        // 同步 API 直接返回图片 URL
        imageUrls = result.images
      } else if (result.taskId) {
        // 异步 API 需要轮询
        logger.info('Task created', { taskId: result.taskId })
        updatePaintingState({ taskId: result.taskId, ppioStatus: 'processing' })

        const taskResult = await service.pollTaskResult(result.taskId, {
          signal: controller.signal,
          onProgress: (progress) => {
            logger.debug('Task progress', { progress })
          }
        })

        logger.info('Task completed', taskResult)

        if (taskResult.images && taskResult.images.length > 0) {
          imageUrls = taskResult.images.map((img) => img.image_url)
        }
      }

      // 下载图片
      if (imageUrls.length > 0) {
        const downloadedFiles = await Promise.all(
          imageUrls.map(async (url) => {
            try {
              if (!url || url.trim() === '') {
                logger.error(t('message.empty_url'))
                return null
              }
              return await window.api.file.download(url)
            } catch (error) {
              logger.error('Failed to download image:', error as Error)
              return null
            }
          })
        )

        const validFiles = downloadedFiles.filter((file): file is FileMetadata => file !== null)

        await FileManager.addFiles(validFiles)

        updatePaintingState({
          files: validFiles,
          urls: imageUrls,
          ppioStatus: 'succeeded'
        })

        setCurrentImageIndex(0)
      }
    } catch (error) {
      logger.error('Image generation failed', error as Error)

      if ((error as Error).message !== 'Task polling aborted') {
        window.modal.error({
          content: getErrorMessage(error),
          centered: true
        })
      }

      updatePaintingState({ ppioStatus: 'failed' })
    } finally {
      setIsLoading(false)
      setGenerating(false)
      setAbortController(null)
    }
  }

  const handleTranslate = async () => {
    if (!painting.prompt?.trim() || isTranslating) return

    setIsTranslating(true)
    try {
      const translatedText = await translateText(painting.prompt, LanguagesEnum.enUS)
      if (translatedText) {
        updatePaintingState({ prompt: translatedText })
      }
    } finally {
      setIsTranslating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onGenerate()
    }

    if (e.key === ' ' && autoTranslateWithSpace && !painting.prompt?.trim()) {
      setSpaceClickCount((prev) => prev + 1)

      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }

      spaceClickTimer.current = setTimeout(() => {
        setSpaceClickCount(0)
      }, 500)

      if (spaceClickCount >= 2) {
        e.preventDefault()
        void handleTranslate()
        setSpaceClickCount(0)
      }
    }
  }

  // 处理图片上传
  const handleImageUpload = async (file: File, fieldKey: keyof PpioPainting = 'imageFile') => {
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        updatePaintingState({ [fieldKey]: base64 })
      }
      reader.readAsDataURL(file)
    }
    return false
  }

  // 渲染配置项表单
  const renderConfigForm = (item: PpioConfigItem) => {
    return (
      <PaintingConfigFieldRenderer
        item={item as any}
        painting={painting as unknown as Record<string, unknown>}
        translate={t}
        onChange={(updates) => updatePaintingState(updates as Partial<PpioPainting>)}
        onGenerateRandomSeed={(key) => {
          if (key === 'ppioSeed') {
            updatePaintingState({ ppioSeed: Math.floor(Math.random() * 2147483647) })
          }
        }}
        onImageUpload={(key, file) => handleImageUpload(file, key as keyof PpioPainting)}
        imagePreviewSrc={item.key ? (painting[item.key] as string | undefined) : undefined}
        imagePlaceholder={
          <img src={IcImageUp} className="h-10 w-10" style={{ filter: theme === 'dark' ? 'invert(100%)' : 'none' }} />
        }
      />
    )
  }

  // 渲染配置项
  const renderConfigItem = (item: PpioConfigItem, index: number) => {
    // 检查条件
    if (item.condition && !item.condition(painting)) {
      return null
    }

    // 跳过 model 选择，因为已经单独渲染
    if (item.key === 'model') {
      return null
    }

    return (
      <div key={index}>
        <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
          {t(item.title!)}
          {item.tooltip && (
            <UiTooltip content={t(item.tooltip)}>
              <Info className="ml-[5px] h-4 w-4 cursor-help text-[var(--color-text-2)] opacity-60 hover:opacity-100" />
            </UiTooltip>
          )}
        </SettingTitle>
        {renderConfigForm(item)}
      </div>
    )
  }

  // 初始化
  useEffect(() => {
    if (filteredPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPaintingScoped(newPainting)
      setPainting(newPainting)
    }

    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [filteredPaintings.length, addPaintingScoped, getNewPainting, mode])

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
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-[var(--color-border)] border-r bg-[var(--color-background)] p-5">
          <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
          {ppioProvider && <ProviderSelect provider={ppioProvider} options={Options} onChange={handleProviderChange} />}

          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <UiSelect value={painting.model} onValueChange={onSelectModel}>
            <SelectTrigger className="h-10 min-h-10 w-full rounded-[0.75rem] border-transparent bg-muted/40 transition-all hover:bg-muted/60">
              <SelectValue placeholder={t('common.model')} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </UiSelect>

          {/* 渲染其他配置项 */}
          {modeConfigs[mode].map(renderConfigItem)}
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
          {/* 模式切换 */}
          <div className="flex justify-center pt-6">
            <Tabs value={mode} onValueChange={handleModeChange}>
              <TabsList>
                {modeOptions.map((option) => (
                  <TabsTrigger key={option.value} value={String(option.value)}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
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
          />
        </div>
        <PaintingsList
          paintings={filteredPaintings}
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

export default PpioPage
