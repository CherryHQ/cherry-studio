import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Input,
  Select as UiSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders } from '@renderer/hooks/useProvider'
import {
  getPaintingsBackgroundOptionsLabel,
  getPaintingsImageSizeOptionsLabel,
  getPaintingsModerationOptionsLabel,
  getPaintingsQualityOptionsLabel
} from '@renderer/i18n/label'
import PaintingsList from '@renderer/pages/paintings/components/PaintingsList'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from '@renderer/pages/paintings/config/NewApiConfig'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { PaintingAction } from '@renderer/types'
import type { FileMetadata } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { isNewApiProvider } from '@renderer/utils/provider'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import ProviderSelect from './components/ProviderSelect'
import { checkProviderEnabled } from './utils'

const logger = loggerService.withContext('NewApiPage')

type NewApiPaintingMode = 'generate' | 'edit'

const NewApiPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<NewApiPaintingMode>('generate')

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [editImageFiles, setEditImageFiles] = useState<File[]>([])

  const { t } = useTranslation()
  const { theme } = useTheme()
  const providers = useAllProviders()
  const location = useLocation()
  const routeName = location.pathname.split('/').pop() || 'new-api'
  const newApiProviders = providers.filter((p) => isNewApiProvider(p))

  const [generating, setGenerating] = useCache('chat.generating')
  const navigate = useNavigate()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const newApiProvider = newApiProviders.find((p) => p.id === routeName) || newApiProviders[0]

  const {
    items: filteredPaintings,
    add: addPainting,
    remove: removePainting,
    update: updatePaintingRecord,
    reorder
  } = usePaintingList({ providerId: newApiProvider.id, mode })

  const [painting, setPainting] = useState<PaintingAction>({ ...DEFAULT_PAINTING, providerId: newApiProvider.id })

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'generate' },
    { label: t('paintings.mode.edit'), value: 'edit' }
  ]

  // 获取编辑模式的图片文件
  const editImages = useMemo(() => {
    return editImageFiles
  }, [editImageFiles])

  const updatePaintingState = useCallback(
    (updates: Partial<PaintingAction>) => {
      const updatedPainting = { ...painting, providerId: newApiProvider.id, ...updates }
      setPainting(updatedPainting)
      updatePaintingRecord(updatedPainting)
    },
    [painting, newApiProvider.id, updatePaintingRecord]
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

  const downloadImages = async (urls: string[]) => {
    const downloadedFiles = await Promise.all(
      urls.map(async (url) => {
        try {
          if (!url?.trim()) {
            logger.error('图像URL为空')
            window.toast.warning(t('message.empty_url'))
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          logger.error('下载图像失败:', error as Error)
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

    return downloadedFiles.filter((file): file is FileMetadata => file !== null)
  }

  const onGenerate = async () => {
    await checkProviderEnabled(newApiProvider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = painting.prompt || ''
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

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    setGenerating(true)

    let body: string | FormData = ''
    const headers: Record<string, string> = {
      Authorization: `Bearer ${AI.getApiKey()}`
    }
    // NOTE: Cherry Studio当下 newapi只接受v1/images/xxx的请求
    // TODO: support gemini https://www.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589
    let url = newApiProvider.apiHost.replace(/\/v1$/, '') + `/v1/images/generations`
    let editUrl = newApiProvider.apiHost.replace(/\/v1$/, '') + `/v1/images/edits`
    if (newApiProvider.id === 'aionly') {
      url = newApiProvider.apiHost.replace(/\/v1$/, '') + `/openai/v1/images/generations`
      editUrl = newApiProvider.apiHost.replace(/\/v1$/, '') + `/openai/v1/images/edits`
    }

    try {
      if (mode === 'generate') {
        const requestData = {
          prompt,
          model: painting.model,
          size: painting.size === 'auto' ? undefined : painting.size,
          background: painting.background === 'auto' ? undefined : painting.background,
          n: painting.n,
          quality: painting.quality === 'auto' ? undefined : painting.quality,
          moderation: painting.moderation === 'auto' ? undefined : painting.moderation
        }

        body = JSON.stringify(requestData)
        headers['Content-Type'] = 'application/json'
      } else if (mode === 'edit') {
        // -------- Edit Mode --------
        if (editImages.length === 0) {
          window.toast.warning(t('paintings.image_file_required'))
          return
        }

        const formData = new FormData()
        formData.append('prompt', prompt)
        formData.append('model', painting.model)
        if (painting.background && painting.background !== 'auto') {
          formData.append('background', painting.background)
        }

        if (painting.size && painting.size !== 'auto') {
          formData.append('size', painting.size)
        }

        if (painting.quality && painting.quality !== 'auto') {
          formData.append('quality', painting.quality)
        }

        if (painting.moderation && painting.moderation !== 'auto') {
          formData.append('moderation', painting.moderation)
        }

        // append images
        editImages.forEach((file) => {
          formData.append('image', file)
        })

        // TODO: mask support later

        body = formData

        // For edit mode we do not set content-type; browser will set multipart boundary
      }

      const requestUrl = mode === 'edit' ? editUrl : url
      const response = await fetch(requestUrl, { method: 'POST', headers, body })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || t('paintings.generate_failed'))
      }

      const data = await response.json()
      const urls = data.data.filter((item) => item.url).map((item) => item.url)
      const base64s = data.data.filter((item) => item.b64_json).map((item) => item.b64_json)

      if (urls.length > 0) {
        const validFiles = await downloadImages(urls)
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls })
      }

      if (base64s?.length > 0) {
        const validFiles = await Promise.all(
          base64s.map(async (base64) => {
            return await window.api.file.saveBase64Image(base64)
          })
        )
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls: [] })
      }
    } catch (error: unknown) {
      handleError(error)
    } finally {
      setIsLoading(false)
      setGenerating(false)
      setAbortController(null)
    }
  }

  const handleRetry = async (painting: PaintingAction) => {
    setIsLoading(true)
    try {
      const validFiles = await downloadImages(painting.urls)
      await FileManager.addFiles(validFiles)
      updatePaintingState({ files: validFiles, urls: painting.urls })
    } catch (error) {
      handleError(error)
    } finally {
      setIsLoading(false)
    }
  }

  const onCancel = () => {
    abortController?.abort()
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const handleAddPainting = () => {
    const newPainting = addPainting(getNewPainting())
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

    void removePainting(paintingToDelete)
  }

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

  const handleModeChange = (value: string) => {
    setMode(value as NewApiPaintingMode)
    setPainting({ ...DEFAULT_PAINTING, providerId: newApiProvider.id })
  }

  // 渲染配置项的函数
  const onSelectPainting = (newPainting: PaintingAction) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
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
      addPainting(newPainting)
      setPainting(newPainting)
    } else {
      const found = filteredPaintings.find((p) => p.id === painting.id)
      if (found) {
        setPainting(found)
      } else {
        setPainting(filteredPaintings[0])
      }
    }
  }, [filteredPaintings, mode, addPainting, getNewPainting, painting.id])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  // if painting.model is not set, set it to the first model in modelOptions
  useEffect(() => {
    if (!painting.model && modelOptions.length > 0) {
      updatePaintingState({ model: modelOptions[0].value })
    }
  }, [modelOptions, painting.model, updatePaintingState])

  return (
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" className="nodrag" onClick={handleAddPainting}>
              <PlusOutlined />
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-[var(--color-background)]">
        <Scrollbar className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] p-5">
          <div className="mb-[5px] flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink
              target="_blank"
              href={PROVIDER_URLS[newApiProvider.id]?.websites?.docs || 'https://docs.newapi.pro/apps/cherry-studio/'}>
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon(newApiProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null
              })()}
            </SettingHelpLink>
          </div>

          <ProviderSelect provider={newApiProvider} options={Options} onChange={handleProviderChange} />

          {/* 当没有可用的 Image Generation 模型时，提示用户先去新增 */}
          {modelOptions.length === 0 && (
            <div className="mt-6 rounded-md border border-dashed border-border bg-muted/10 p-6 text-center">
              <div className="mb-3 text-sm text-muted-foreground">
                {t('paintings.no_image_generation_model', {
                  endpoint_type: t('endpoint_type.image-generation')
                })}
              </div>
              <Button variant="default" onClick={handleShowAddModelPopup}>
                {t('paintings.go_to_settings')}
              </Button>
            </div>
          )}

          {modelOptions.length > 0 && (
            <>
              {mode === 'edit' && (
                <>
                  <SettingTitle style={{ marginTop: 20 }}>{t('paintings.input_image')}</SettingTitle>
                  <div className="mb-4 flex flex-col gap-2">
                    <label className="flex min-h-[60px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 hover:bg-muted/30">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.target.files || [])
                          files.forEach((file) => handleImageUpload(file))
                          event.target.value = ''
                        }}
                      />
                      <img
                        src={IcImageUp}
                        alt={t('common.upload_image')}
                        className="h-5 w-5"
                        style={{ filter: theme === 'dark' ? 'invert(100%)' : 'none' }}
                      />
                      <span className="text-sm text-muted-foreground">{t('paintings.input_image')}</span>
                    </label>

                    {editImageFiles.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {editImageFiles.map((file, idx) => (
                          <div
                            key={`${file.name}-${idx}`}
                            className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2 text-sm">
                            <span className="truncate">{file.name || `image_${idx + 1}.png`}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditImageFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== idx))
                              }}>
                              {t('common.delete')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Model Selector */}
              <SettingTitle style={{ marginTop: 20 }}>{t('paintings.model')}</SettingTitle>
              <UiSelect value={painting.model} onValueChange={handleModelChange}>
                <SelectTrigger className="mb-4 w-full">
                  <SelectValue placeholder={t('paintings.model')} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(groupedModelOptions).map(([groupName, options]) => (
                    <SelectGroup key={groupName}>
                      <SelectLabel>{groupName}</SelectLabel>
                      {options.map((m) => (
                        <SelectItem value={m.value} key={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </UiSelect>

              {/* Image Size */}
              {selectedModelConfig?.imageSizes && selectedModelConfig.imageSizes.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.image.size')}</SettingTitle>
                  <UiSelect value={painting.size} onValueChange={handleSizeChange}>
                    <SelectTrigger className="mb-4 w-full">
                      <SelectValue placeholder={t('paintings.image.size')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedModelConfig.imageSizes.map((s) => (
                        <SelectItem value={s.value} key={s.value}>
                          {getPaintingsImageSizeOptionsLabel(s.value) ?? s.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </UiSelect>
                </>
              )}

              {/* Quality */}
              {selectedModelConfig?.quality && selectedModelConfig.quality.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.quality')}</SettingTitle>
                  <UiSelect value={painting.quality} onValueChange={handleQualityChange}>
                    <SelectTrigger className="mb-4 w-full">
                      <SelectValue placeholder={t('paintings.quality')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedModelConfig.quality.map((q) => (
                        <SelectItem value={q.value} key={q.value}>
                          {getPaintingsQualityOptionsLabel(q.value) ?? q.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </UiSelect>
                </>
              )}

              {/* Moderation */}
              {mode !== 'edit' && selectedModelConfig?.moderation && selectedModelConfig.moderation.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.moderation')}</SettingTitle>
                  <UiSelect value={painting.moderation} onValueChange={handleModerationChange}>
                    <SelectTrigger className="mb-4 w-full">
                      <SelectValue placeholder={t('paintings.moderation')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedModelConfig.moderation.map((m) => (
                        <SelectItem value={m.value} key={m.value}>
                          {getPaintingsModerationOptionsLabel(m.value) ?? m.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </UiSelect>
                </>
              )}

              {/* Background */}
              {mode === 'edit' && selectedModelConfig?.background && selectedModelConfig.background.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.background')}</SettingTitle>
                  <UiSelect
                    value={painting.background}
                    onValueChange={(value) => updatePaintingState({ background: value })}>
                    <SelectTrigger className="mb-4 w-full">
                      <SelectValue placeholder={t('paintings.background')} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedModelConfig.background.map((b) => (
                        <SelectItem value={b.value} key={b.value}>
                          {getPaintingsBackgroundOptionsLabel(b.value) ?? b.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </UiSelect>
                </>
              )}

              {/* Number of Images (n) */}
              {selectedModelConfig?.max_images && (
                <>
                  <SettingTitle>{t('paintings.number_images')}</SettingTitle>
                  <Input
                    className="mb-4"
                    type="number"
                    min={1}
                    max={selectedModelConfig.max_images}
                    value={String(painting.n || 1)}
                    onChange={(e) => handleNChange(e.target.value)}
                  />
                </>
              )}
            </>
          )}
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
          {/* 添加功能切换分段控制器 */}
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
            retry={handleRetry}
          />
          <PaintingPromptBar
            prompt={painting.prompt || ''}
            disabled={isLoading}
            placeholder={
              isTranslating
                ? t('paintings.translating')
                : painting.model?.startsWith('imagen-')
                  ? t('paintings.prompt_placeholder_en')
                  : t('paintings.prompt_placeholder_edit')
            }
            onPromptChange={(value) => updatePaintingState({ prompt: value })}
            onGenerate={onGenerate}
            onKeyDown={handleKeyDown}
            showTranslate
            isTranslating={isTranslating}
            onTranslated={(translatedText) => updatePaintingState({ prompt: translatedText })}
          />
        </div>
        <PaintingsList
          paintings={filteredPaintings}
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

export default NewApiPage
