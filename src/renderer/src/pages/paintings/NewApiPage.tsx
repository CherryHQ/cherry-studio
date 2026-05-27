import { EmptyState, SegmentedControl } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import {
  getPaintingsBackgroundOptionsLabel,
  getPaintingsImageSizeOptionsLabel,
  getPaintingsModerationOptionsLabel,
  getPaintingsQualityOptionsLabel
} from '@renderer/i18n/label'
import PaintingsList from '@renderer/pages/paintings/components/PaintingsList'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from '@renderer/pages/paintings/providers/newapi/config'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { isNewApiProvider } from '@renderer/utils/provider'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { FilePicker, NumberField } from './components/PaintingControls'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingSelect from './components/PaintingSelect'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingImageNavigation } from './hooks/usePaintingImageNavigation'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { usePaintingProvider, usePaintingProviders } from './hooks/usePaintingProvider'
import { generateNewApiImages, type NewApiImageMode } from './providers/newapi/provider'
import { checkProviderEnabled, findPaintingByFiles } from './utils'
import { fileEntryToImageFile, saveGeneratedPaintingFiles, savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('NewApiPage')

const NewApiPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<keyof PaintingsState>('openai_image_generate')
  const { addPainting, removePainting, updatePainting, openai_image_generate, openai_image_edit } = usePaintings()

  const newApiPaintings = useMemo(() => {
    return {
      openai_image_generate,
      openai_image_edit
    }
  }, [openai_image_generate, openai_image_edit])

  const [editImageFiles, setEditImageFiles] = useState<File[]>([])

  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = usePaintingProviders()
  const location = useLocation()
  const routeName = location.pathname.split('/').pop() || 'new-api'
  const newApiProviders = providers.filter((p) => isNewApiProvider(p))

  const navigate = useNavigate()
  const routeNewApiProvider = newApiProviders.find((p) => p.id === routeName) || newApiProviders[0]
  const { provider: newApiProvider } = usePaintingProvider(routeNewApiProvider?.id || 'new-api')

  const filteredPaintings = useMemo(
    () => (newApiPaintings[mode] || []).filter((p) => p.providerId === newApiProvider.id),
    [newApiPaintings, mode, newApiProvider.id]
  )
  const [painting, setPainting] = useState<PaintingAction>({ ...DEFAULT_PAINTING, providerId: newApiProvider.id })
  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(painting.files.length)

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'openai_image_generate' },
    { label: t('paintings.mode.edit'), value: 'openai_image_edit' }
  ]

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 获取编辑模式的图片文件
  const editImages = editImageFiles
  const editImagePreviews = useMemo(
    () => editImageFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [editImageFiles]
  )

  useEffect(() => {
    return () => {
      editImagePreviews.forEach(({ url }) => URL.revokeObjectURL(url))
    }
  }, [editImagePreviews])

  useEffect(() => {
    if (mode !== 'openai_image_edit') {
      return
    }

    let isActive = true

    const syncEditImages = async () => {
      if (painting.files.length === 0) {
        setEditImageFiles([])
        return
      }

      try {
        const files = await Promise.all(painting.files.map(async (file, index) => fileEntryToImageFile(file, index)))

        if (isActive) {
          setEditImageFiles(files)
        }
      } catch (error) {
        logger.error('Failed to sync edit images from selected painting:', error as Error)

        if (isActive) {
          setEditImageFiles([])
        }
      }
    }

    void syncEditImages()

    return () => {
      isActive = false
    }
  }, [mode, painting.files])

  const updatePaintingState = useCallback(
    (updates: Partial<PaintingAction>) => {
      const updatedPainting = { ...painting, providerId: newApiProvider.id, ...updates }
      setPainting(updatedPainting)
      updatePainting(mode, updatedPainting)
    },
    [painting, newApiProvider.id, mode, updatePainting]
  )

  // ---------------- Model Related Configurations ----------------
  // const modelOptions = MODELS.map((m) => ({ label: m.name, value: m.name }))

  const modelOptions = useMemo(() => {
    const customModels = newApiProvider.models
      .filter((m) => m.endpoint_type && m.endpoint_type === 'image-generation')
      .map((m) => ({
        label: m.name,
        value: m.id,
        custom: !SUPPORTED_MODELS.includes(m.id),
        group: m.group
      }))
    return [...customModels]
  }, [newApiProvider.models])

  // 根据 group 将模型进行分组，便于在下拉列表中分组渲染
  const groupedModelOptions = useMemo(() => {
    return modelOptions.reduce<Record<string, typeof modelOptions>>((acc, option) => {
      const groupName = option.group
      if (!acc[groupName]) {
        acc[groupName] = []
      }
      acc[groupName].push(option)
      return acc
    }, {})
  }, [modelOptions])

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_PAINTING,
      model: painting.model || modelOptions[0]?.value || '',
      id: uuid(),
      providerId: newApiProvider.id
    }
  }, [modelOptions, painting.model, newApiProvider.id])

  const selectedModelConfig = useMemo(
    () => MODELS.find((m) => m.name === painting.model) || MODELS[0],
    [painting.model]
  )

  const handleModelChange = (value: string) => {
    const modelConfig = MODELS.find((m) => m.name === value)
    const updates: Partial<PaintingAction> = { model: value }

    // 设置默认值
    if (modelConfig?.imageSizes?.length) {
      updates.size = modelConfig.imageSizes[0].value
    }
    if (modelConfig?.quality?.length) {
      updates.quality = modelConfig.quality[0].value
    }
    if (modelConfig?.moderation?.length) {
      updates.moderation = modelConfig.moderation[0].value
    }
    updates.n = 1
    updatePaintingState(updates)
  }

  const handleSizeChange = (value: string) => {
    updatePaintingState({ size: value })
  }

  const handleQualityChange = (value: string) => {
    updatePaintingState({ quality: value })
  }

  const handleModerationChange = (value: string) => {
    updatePaintingState({ moderation: value })
  }

  const handleNChange = (value: number | string | null) => {
    if (value !== null && value !== undefined && value !== '') {
      updatePaintingState({ n: Number(value) })
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
  const { isLoading, setIsLoading, generating, runGeneration, cancelGeneration } = usePaintingGenerationTask({
    onError: handleError
  })

  const onGenerate = async () => {
    await checkProviderEnabled(newApiProvider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) return
    }

    const prompt = textareaRef.current?.value || ''
    updatePaintingState({ prompt })

    const AI = new AiProvider(newApiProvider)

    if (!AI.getApiKey()) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    if (!painting.model || !painting.prompt) {
      return
    }

    await runGeneration(async (signal) => {
      if (mode === 'openai_image_edit') {
        if (editImages.length === 0) {
          window.toast.warning(t('paintings.image_file_required'))
          return
        }
      }

      const result = await generateNewApiImages({
        provider: newApiProvider,
        apiKey: AI.getApiKey(),
        mode: mode as NewApiImageMode,
        painting,
        prompt,
        editImages,
        fallbackErrorMessage: t('paintings.generate_failed'),
        signal
      })

      const savedResult = await savePaintingGenerationResult(result, {
        t,
        emptyUrlLogMessage: '图像URL为空',
        errorLogMessage: '下载图像失败:'
      })

      if (savedResult) {
        updatePaintingState({
          files: savedResult.files,
          urls: savedResult.urls
        })
      }
    })
  }

  const handleRetry = async (painting: PaintingAction) => {
    setIsLoading(true)
    try {
      const validFiles = await saveGeneratedPaintingFiles({
        urls: painting.urls,
        t,
        emptyUrlLogMessage: '图像URL为空',
        errorLogMessage: '下载图像失败:'
      })
      updatePaintingState({ files: validFiles, urls: painting.urls })
    } catch (error) {
      handleError(error)
    } finally {
      setIsLoading(false)
    }
  }

  const onCancel = () => {
    cancelGeneration()
  }

  const handleAddPainting = () => {
    const newPainting = addPainting(mode, getNewPainting())
    updatePainting(mode, newPainting)
    setPainting(newPainting)
    return newPainting
  }

  const onDeletePainting = (paintingToDelete: PaintingAction) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = filteredPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(filteredPaintings[currentIndex - 1])
      } else if (filteredPaintings.length > 1) {
        setPainting(filteredPaintings[1])
      }
    }

    void removePainting(mode, paintingToDelete)
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

  // 处理模式切换
  const handleModeChange = (value: string) => {
    const nextMode = value as keyof PaintingsState

    setMode(nextMode)

    if (nextMode === 'openai_image_edit' && mode === 'openai_image_generate' && painting.files.length > 0) {
      const existingEditPainting = findPaintingByFiles(
        newApiPaintings.openai_image_edit || [],
        newApiProvider.id,
        painting.files
      )

      if (existingEditPainting) {
        setPainting(existingEditPainting)
        return
      }

      const seededPainting = {
        ...painting,
        id: uuid(),
        providerId: newApiProvider.id
      }

      addPainting(nextMode, seededPainting)
      setPainting(seededPainting)
      return
    }

    const list = (newApiPaintings[nextMode] || []).filter((p) => p.providerId === newApiProvider.id)
    setPainting(list[0] || { ...DEFAULT_PAINTING, providerId: newApiProvider.id })
  }

  // 渲染配置项的函数
  const onSelectPainting = (newPainting: PaintingAction) => {
    if (generating) return
    setPainting(newPainting)
    resetImageIndex()
  }

  const handleImageUpload = (file: File) => {
    setEditImageFiles((prev) => [...prev, file])
    return false // 阻止默认上传行为
  }

  // 当 modelOptions 为空时，引导用户跳转到 Provider 设置页面，新增 image-generation 端点模型
  const handleShowAddModelPopup = () => {
    void navigate({ to: `/settings/provider?id=${newApiProvider.id}` })
  }

  useEffect(() => {
    if (filteredPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting(mode, newPainting)
      setPainting(newPainting)
    } else {
      // 如果当前 painting 存在于 filteredPaintings 中，则优先显示当前 painting
      const found = filteredPaintings.find((p) => p.id === painting.id)
      if (found) {
        setPainting(found)
      } else {
        setPainting(filteredPaintings[0])
      }
    }
  }, [filteredPaintings, mode, addPainting, getNewPainting, painting.id])

  // if painting.model is not set, set it to the first model in modelOptions
  useEffect(() => {
    if (!painting.model && modelOptions.length > 0) {
      updatePaintingState({ model: modelOptions[0].value })
    }
  }, [modelOptions, painting.model, updatePaintingState])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          <div className="mb-1.25 flex items-center justify-between">
            <SettingTitle className="mb-1.25">{t('common.provider')}</SettingTitle>
            <SettingHelpLink
              target="_blank"
              href={PROVIDER_URLS[newApiProvider.id]?.websites?.docs || 'https://docs.newapi.pro/apps/cherry-studio/'}>
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon(newApiProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null
              })()}
            </SettingHelpLink>
          </div>

          <ProviderSelect provider={newApiProvider} options={Options} onChange={handleProviderChange} />

          {/* 当没有可用的 Image Generation 模型时，提示用户先去新增 */}
          {modelOptions.length === 0 && (
            <EmptyState
              className="mt-6"
              compact
              description={t('paintings.no_image_generation_model', {
                endpoint_type: t('endpoint_type.image-generation')
              })}
              actionLabel={t('paintings.go_to_settings')}
              onAction={handleShowAddModelPopup}
            />
          )}

          {modelOptions.length > 0 && (
            <>
              {mode === 'openai_image_edit' && (
                <>
                  <SettingTitle className="mt-5 mb-1.25">{t('paintings.input_image')}</SettingTitle>
                  <FilePicker
                    className="flex h-15 w-full cursor-pointer flex-row items-center justify-center gap-2 rounded-md border border-border border-dashed bg-background-subtle hover:bg-muted"
                    accept="image/png, image/jpeg, image/gif"
                    multiple
                    onFiles={(files) => files.slice(0, 16 - editImageFiles.length).forEach(handleImageUpload)}>
                    <img src={IcImageUp} alt="" className={theme === 'dark' ? 'h-5 w-5 invert' : 'h-5 w-5'} />
                  </FilePicker>
                  {editImageFiles.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {editImagePreviews.map(({ file, url }, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className="flex items-center gap-2 rounded-md border border-border bg-background-subtle px-2 py-1 text-xs">
                          <img
                            src={url}
                            alt={file.name || `image_${idx + 1}.png`}
                            className="size-8 shrink-0 rounded border border-border object-cover"
                          />
                          <span className="min-w-0 flex-1 truncate">{file.name || `image_${idx + 1}.png`}</span>
                          <button
                            type="button"
                            className="text-foreground-secondary hover:text-destructive"
                            onClick={() => setEditImageFiles((prev) => prev.filter((_, index) => index !== idx))}>
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Model Selector */}
              <SettingTitle className="mt-5 mb-1.25">{t('paintings.model')}</SettingTitle>
              <PaintingSelect value={painting.model} onChange={handleModelChange} className="mb-3.75 w-full">
                {Object.entries(groupedModelOptions).map(([groupName, options]) => (
                  <PaintingSelect.OptGroup label={groupName} key={groupName}>
                    {options.map((m) => (
                      <PaintingSelect.Option value={m.value} key={m.value}>
                        {m.label}
                      </PaintingSelect.Option>
                    ))}
                  </PaintingSelect.OptGroup>
                ))}
              </PaintingSelect>

              {/* Image Size */}
              {selectedModelConfig?.imageSizes && selectedModelConfig.imageSizes.length > 0 && (
                <>
                  <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.image.size')}</SettingTitle>
                  <PaintingSelect value={painting.size} onChange={handleSizeChange} className="mb-3.75 w-full">
                    {selectedModelConfig.imageSizes.map((s) => (
                      <PaintingSelect.Option value={s.value} key={s.value}>
                        {getPaintingsImageSizeOptionsLabel(s.value) ?? s.value}
                      </PaintingSelect.Option>
                    ))}
                  </PaintingSelect>
                </>
              )}

              {/* Quality */}
              {selectedModelConfig?.quality && selectedModelConfig.quality.length > 0 && (
                <>
                  <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.quality')}</SettingTitle>
                  <PaintingSelect value={painting.quality} onChange={handleQualityChange} className="mb-3.75 w-full">
                    {selectedModelConfig.quality.map((q) => (
                      <PaintingSelect.Option value={q.value} key={q.value}>
                        {getPaintingsQualityOptionsLabel(q.value) ?? q.value}
                      </PaintingSelect.Option>
                    ))}
                  </PaintingSelect>
                </>
              )}

              {/* Moderation */}
              {mode !== 'openai_image_edit' &&
                selectedModelConfig?.moderation &&
                selectedModelConfig.moderation.length > 0 && (
                  <>
                    <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.moderation')}</SettingTitle>
                    <PaintingSelect
                      value={painting.moderation}
                      onChange={handleModerationChange}
                      className="mb-3.75 w-full">
                      {selectedModelConfig.moderation.map((m) => (
                        <PaintingSelect.Option value={m.value} key={m.value}>
                          {getPaintingsModerationOptionsLabel(m.value) ?? m.value}
                        </PaintingSelect.Option>
                      ))}
                    </PaintingSelect>
                  </>
                )}

              {/* Background */}
              {mode === 'openai_image_edit' &&
                selectedModelConfig?.background &&
                selectedModelConfig.background.length > 0 && (
                  <>
                    <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.background')}</SettingTitle>
                    <PaintingSelect
                      value={painting.background}
                      onChange={(value) => updatePaintingState({ background: value })}
                      className="mb-3.75 w-full">
                      {selectedModelConfig.background.map((b) => (
                        <PaintingSelect.Option value={b.value} key={b.value}>
                          {getPaintingsBackgroundOptionsLabel(b.value) ?? b.value}
                        </PaintingSelect.Option>
                      ))}
                    </PaintingSelect>
                  </>
                )}

              {/* Number of Images (n) */}
              {selectedModelConfig?.max_images && (
                <>
                  <SettingTitle className="mt-3.75 mb-1.25">{t('paintings.number_images')}</SettingTitle>
                  <NumberField
                    min={1}
                    max={selectedModelConfig.max_images}
                    value={painting.n || 1}
                    onChange={handleNChange}
                    className="mb-3.75 w-full"
                  />
                </>
              )}
            </>
          )}
        </>
      }
      artboard={
        <>
          {/* 添加功能切换分段控制器 */}
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
            retry={handleRetry}
          />
        </>
      }
      promptBar={
        <PaintingPromptBar
          textareaRef={textareaRef}
          value={painting.prompt}
          disabled={isLoading}
          placeholder={
            isTranslating
              ? t('paintings.translating')
              : painting.model?.startsWith('imagen-')
                ? t('paintings.prompt_placeholder_en')
                : t('paintings.prompt_placeholder_edit')
          }
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
          namespace={mode}
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

export default NewApiPage
