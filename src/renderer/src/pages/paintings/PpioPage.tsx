import { SegmentedControl, Switch, Textarea, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import type { PaintingsState, PpioPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useNavigate } from '@tanstack/react-router'
import { Info, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { FilePicker, TextInput } from './components/PaintingControls'
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
  createModeConfigs,
  DEFAULT_PPIO_PAINTING,
  getModelsByMode,
  type PpioConfigItem,
  type PpioMode
} from './providers/ppio/config'
import PpioProvider from './providers/ppio/provider'
import { checkProviderEnabled } from './utils'
import { savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('PpioPage')

// 使用函数创建配置项
const modeConfigs = createModeConfigs()

const PpioPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [mode, setMode] = useState<PpioMode>('ppio_draw')
  const { ppio_draw = [], ppio_edit = [], addPainting, removePainting, updatePainting } = usePaintings()

  const paintings = useMemo(
    () => ({
      ppio_draw,
      ppio_edit
    }),
    [ppio_draw, ppio_edit]
  )

  const filteredPaintings = useMemo(() => paintings[mode] || [], [paintings, mode])

  const getDefaultPainting = useCallback((currentMode: PpioMode): PpioPainting => {
    const models = getModelsByMode(currentMode)
    return {
      ...DEFAULT_PPIO_PAINTING,
      model: models[0]?.id || DEFAULT_PPIO_PAINTING.model,
      id: uuid()
    }
  }, [])

  const [painting, setPainting] = useState<PpioPainting>(filteredPaintings[0] || getDefaultPainting(mode))
  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(
    painting.files?.length ?? 0
  )

  const { provider: ppioProvider } = usePaintingProvider('ppio')

  const navigate = useNavigate()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      updatePainting(mode, updatedPainting)
    },
    [painting, updatePainting, mode]
  )

  const onSelectModel = (modelId: string) => {
    updatePaintingState({ model: modelId })
  }

  const onSelectPainting = (selectedPainting: PpioPainting) => {
    setPainting(selectedPainting)
    resetImageIndex()
  }

  const onDeletePainting = async (paintingToDelete: PpioPainting) => {
    await removePainting(mode, paintingToDelete)
    if (painting.id === paintingToDelete.id) {
      const remainingPaintings = filteredPaintings.filter((p) => p.id !== paintingToDelete.id)
      if (remainingPaintings.length > 0) {
        setPainting(remainingPaintings[0])
      } else {
        const newPainting = getNewPainting()
        addPainting(mode, newPainting)
        setPainting(newPainting)
      }
    }
  }

  const handleAddPainting = () => {
    const newPainting = addPainting(mode, getNewPainting())
    setPainting(newPainting)
    return newPainting
  }

  const handleError = useCallback(
    (error: unknown) => {
      logger.error('Image generation failed', error as Error)

      if ((error as Error).message !== 'Task polling aborted') {
        window.modal.error({
          content: getErrorMessage(error),
          centered: true
        })
      }

      updatePaintingState({ ppioStatus: 'failed' })
    },
    [updatePaintingState]
  )

  const { isLoading, runGeneration, cancelGeneration } = usePaintingGenerationTask({
    onError: handleError
  })

  const onCancel = () => {
    cancelGeneration({ finishImmediately: true })
  }

  const handleProviderChange = (providerId: string) => {
    void navigate({ to: '../' + providerId, replace: true })
  }

  const handleModeChange = (value: string) => {
    const newMode = value as PpioMode
    setMode(newMode)
    if (paintings[newMode] && paintings[newMode].length > 0) {
      setPainting(paintings[newMode][0])
    } else {
      setPainting(getDefaultPainting(newMode))
    }
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

    await runGeneration(async (signal) => {
      const provider = new PpioProvider(ppioProvider.apiKey)

      logger.info('Starting image generation', { model: painting.model, mode })

      const result = await provider.generate(painting)

      let imageUrls: string[] = []

      if (result.images) {
        // 同步 API 直接返回图片 URL
        imageUrls = result.images
      } else if (result.taskId) {
        // 异步 API 需要轮询
        logger.info('Task created', { taskId: result.taskId })
        updatePaintingState({ taskId: result.taskId, ppioStatus: 'processing' })

        const taskResult = await provider.pollTaskResult(result.taskId, {
          signal,
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
        const savedResult = await savePaintingGenerationResult(
          {
            urls: imageUrls,
            base64s: []
          },
          {
            t,
            emptyUrlLogMessage: t('message.empty_url'),
            errorLogMessage: 'Failed to download image:'
          }
        )

        if (!savedResult) {
          return
        }

        updatePaintingState({
          files: savedResult.files,
          urls: savedResult.urls,
          ppioStatus: 'succeeded'
        })

        resetImageIndex()
      }
    })
  }

  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    onTranslated: (translatedText) => {
      if (translatedText) {
        updatePaintingState({ prompt: translatedText })
      }
    },
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  // 处理图片上传
  const handleImageUpload = async (file: File, fieldKey: keyof PpioPainting = 'imageFile') => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      updatePaintingState({ [fieldKey]: base64 })
    }
    reader.readAsDataURL(file)
  }

  // 渲染配置项表单
  const renderConfigForm = (item: PpioConfigItem) => {
    switch (item.type) {
      case 'select':
        return (
          <PaintingSelect
            value={(painting[item.key!] || item.initialValue) as string | number | undefined}
            options={item.options}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
            className="w-full"
          />
        )
      case 'input':
        if (item.key === 'ppioSeed') {
          return (
            <TextInput
              value={painting.ppioSeed === -1 ? '' : painting.ppioSeed}
              placeholder={t('paintings.seed_random')}
              onChange={(e) => {
                const value = e.target.value
                updatePaintingState({ ppioSeed: value ? parseInt(value, 10) : -1 })
              }}
              suffix={
                <RefreshCw
                  onClick={() => updatePaintingState({ ppioSeed: Math.floor(Math.random() * 2147483647) })}
                  className="size-4 cursor-pointer text-foreground-secondary"
                />
              }
            />
          )
        }
        return (
          <TextInput
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
          />
        )
      case 'switch':
        return (
          <div className="flex items-center">
            <Switch
              checked={(painting[item.key!] ?? item.initialValue) as boolean}
              onCheckedChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </div>
        )
      case 'image': {
        const imageKey = item.key as keyof PpioPainting
        const imageValue = painting[imageKey] as string | undefined
        return (
          <FilePicker
            className="flex h-30 w-full items-center justify-center rounded-lg border border-border border-dashed bg-background-subtle hover:bg-muted"
            accept="image/png, image/jpeg, image/gif, image/webp"
            onFiles={(files) => {
              const file = files[0]
              if (file) {
                void handleImageUpload(file, imageKey)
              }
            }}>
            {imageValue ? (
              <div className="flex h-full w-full items-center justify-center overflow-hidden">
                <img
                  src={imageValue}
                  alt={t('common.image_preview')}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <img src={IcImageUp} alt="" className={theme === 'dark' ? 'h-10 w-10 invert' : 'h-10 w-10'} />
            )}
          </FilePicker>
        )
      }
      case 'textarea':
        return (
          <Textarea.Input
            value={(painting[item.key!] || '') as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            placeholder={item.required ? t('paintings.prompt_placeholder') : ''}
            rows={3}
            className="resize-none!"
          />
        )
      default:
        return null
    }
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
        <SettingTitle className="mt-3.75 mb-1.25">
          {t(item.title!)}
          {item.tooltip && (
            <Tooltip title={t(item.tooltip)}>
              <Info className="ml-1.25 size-4 cursor-help text-foreground-secondary opacity-60 hover:opacity-100" />
            </Tooltip>
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
      addPainting(mode, newPainting)
      setPainting(newPainting)
    }
  }, [filteredPaintings.length, addPainting, getNewPainting, mode])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          <SettingTitle className="mb-1.25">{t('common.provider')}</SettingTitle>
          {ppioProvider && <ProviderSelect provider={ppioProvider} options={Options} onChange={handleProviderChange} />}

          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <PaintingSelect value={painting.model} onChange={onSelectModel} className="w-full">
            {modelOptions.map((group) => (
              <PaintingSelect.OptGroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <PaintingSelect.Option key={option.value} value={option.value}>
                    {option.label}
                  </PaintingSelect.Option>
                ))}
              </PaintingSelect.OptGroup>
            ))}
          </PaintingSelect>

          {/* 渲染其他配置项 */}
          {modeConfigs[mode].map(renderConfigItem)}
        </>
      }
      artboard={
        <>
          {/* 模式切换 */}
          <div className="flex justify-center pt-6">
            <SegmentedControl value={mode} onValueChange={handleModeChange} options={modeOptions} />
          </div>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
          />
        </>
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
          namespace={mode as keyof PaintingsState}
          paintings={filteredPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      }
    />
  )
}

export default PpioPage
