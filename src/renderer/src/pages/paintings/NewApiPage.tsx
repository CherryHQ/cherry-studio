import { PlusOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import {
  getPaintingsBackgroundOptionsLabel,
  getPaintingsImageSizeOptionsLabel,
  getPaintingsModerationOptionsLabel,
  getPaintingsQualityOptionsLabel
} from '@renderer/i18n/label'
import PaintingsList from '@renderer/pages/paintings/components/PaintingsList'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from '@renderer/pages/paintings/providers/newapi/config'
import FileManager from '@renderer/services/FileManager'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { isNewApiProvider } from '@renderer/utils/provider'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Empty, InputNumber, Segmented, Select, Upload } from 'antd'
import type { RcFile } from 'antd/es/upload'
import type { UploadFile } from 'antd/es/upload/interface'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { generateNewApiImages, type NewApiImageMode } from './providers/newapi/provider'
import { checkProviderEnabled, findPaintingByFiles } from './utils'
import { saveGeneratedPaintingFiles, savePaintingGenerationResult } from './utils/imageFiles'

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

  // moved below after newApiProvider is defined
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [editImageFiles, setEditImageFiles] = useState<File[]>([])

  const { t } = useTranslation()
  const { theme } = useTheme()
  const providers = useAllProviders()
  const location = useLocation()
  const routeName = location.pathname.split('/').pop() || 'new-api'
  const newApiProviders = providers.filter((p) => isNewApiProvider(p))

  const navigate = useNavigate()
  const newApiProvider = newApiProviders.find((p) => p.id === routeName) || newApiProviders[0]

  const filteredPaintings = useMemo(
    () => (newApiPaintings[mode] || []).filter((p) => p.providerId === newApiProvider.id),
    [newApiPaintings, mode, newApiProvider.id]
  )
  const [painting, setPainting] = useState<PaintingAction>({ ...DEFAULT_PAINTING, providerId: newApiProvider.id })

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'openai_image_generate' },
    { label: t('paintings.mode.edit'), value: 'openai_image_edit' }
  ]

  const textareaRef = useRef<any>(null)

  // 获取编辑模式的图片文件
  const editImages = editImageFiles

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
        const files = await Promise.all(
          painting.files.map(async (file, index) => {
            const { data, mime } = await window.api.file.binaryImage(file.id + file.ext)
            const fileName = file.name || `image_${index + 1}${file.ext}`

            return new File([data], fileName, {
              type: mime,
              lastModified: new Date(file.created_at).getTime()
            })
          })
        )

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
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''
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

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
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
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-background">
        <Scrollbar className="flex h-full max-w-(--assistants-width) flex-1 flex-col bg-background p-5 [border-right:0.5px_solid_var(--color-border)]">
          <div className="mb-1.25 flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
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
            <Empty
              style={{ marginTop: 24 }}
              description={t('paintings.no_image_generation_model', {
                endpoint_type: t('endpoint_type.image-generation')
              })}>
              <Button variant="default" onClick={handleShowAddModelPopup}>
                {t('paintings.go_to_settings')}
              </Button>
            </Empty>
          )}

          {modelOptions.length > 0 && (
            <>
              {mode === 'openai_image_edit' && (
                <>
                  <SettingTitle style={{ marginTop: 20 }}>{t('paintings.input_image')}</SettingTitle>
                  <Upload
                    className="[&_.ant-upload.ant-upload-select]:border! [&_.ant-upload.ant-upload-select]:h-15! [&_.ant-upload.ant-upload-select]:w-full! [&_.ant-upload.ant-upload-select]:border-border! [&_.ant-upload.ant-upload-select]:border-dashed!"
                    accept="image/png, image/jpeg, image/gif"
                    maxCount={16}
                    showUploadList={true}
                    listType="picture"
                    beforeUpload={handleImageUpload}
                    fileList={editImageFiles.map((file, idx): UploadFile<any> => {
                      const rcFile: RcFile = {
                        ...file,
                        uid: String(idx),
                        lastModifiedDate: file.lastModified ? new Date(file.lastModified) : new Date()
                      }
                      return {
                        uid: rcFile.uid,
                        name: rcFile.name || `image_${idx + 1}.png`,
                        status: 'done',
                        url: URL.createObjectURL(file),
                        originFileObj: rcFile,
                        lastModifiedDate: rcFile.lastModifiedDate
                      }
                    })}
                    onRemove={(file) => {
                      setEditImageFiles((prev) =>
                        prev.filter((f) => {
                          const idx = prev.indexOf(f)
                          return String(idx) !== file.uid
                        })
                      )
                      return true
                    }}>
                    <div className="flex h-full cursor-pointer flex-row items-center justify-center gap-2">
                      <img src={IcImageUp} alt="" className={theme === 'dark' ? 'h-5 w-5 invert' : 'h-5 w-5'} />
                    </div>
                  </Upload>
                </>
              )}

              {/* Model Selector */}
              <SettingTitle style={{ marginTop: 20 }}>{t('paintings.model')}</SettingTitle>
              <Select value={painting.model} onChange={handleModelChange} style={{ width: '100%', marginBottom: 15 }}>
                {Object.entries(groupedModelOptions).map(([groupName, options]) => (
                  <Select.OptGroup label={groupName} key={groupName}>
                    {options.map((m) => (
                      <Select.Option value={m.value} key={m.value}>
                        {m.label}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>

              {/* Image Size */}
              {selectedModelConfig?.imageSizes && selectedModelConfig.imageSizes.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.image.size')}</SettingTitle>
                  <Select value={painting.size} onChange={handleSizeChange} style={{ width: '100%', marginBottom: 15 }}>
                    {selectedModelConfig.imageSizes.map((s) => (
                      <Select.Option value={s.value} key={s.value}>
                        {getPaintingsImageSizeOptionsLabel(s.value) ?? s.value}
                      </Select.Option>
                    ))}
                  </Select>
                </>
              )}

              {/* Quality */}
              {selectedModelConfig?.quality && selectedModelConfig.quality.length > 0 && (
                <>
                  <SettingTitle>{t('paintings.quality')}</SettingTitle>
                  <Select
                    value={painting.quality}
                    onChange={handleQualityChange}
                    style={{ width: '100%', marginBottom: 15 }}>
                    {selectedModelConfig.quality.map((q) => (
                      <Select.Option value={q.value} key={q.value}>
                        {getPaintingsQualityOptionsLabel(q.value) ?? q.value}
                      </Select.Option>
                    ))}
                  </Select>
                </>
              )}

              {/* Moderation */}
              {mode !== 'openai_image_edit' &&
                selectedModelConfig?.moderation &&
                selectedModelConfig.moderation.length > 0 && (
                  <>
                    <SettingTitle>{t('paintings.moderation')}</SettingTitle>
                    <Select
                      value={painting.moderation}
                      onChange={handleModerationChange}
                      style={{ width: '100%', marginBottom: 15 }}>
                      {selectedModelConfig.moderation.map((m) => (
                        <Select.Option value={m.value} key={m.value}>
                          {getPaintingsModerationOptionsLabel(m.value) ?? m.value}
                        </Select.Option>
                      ))}
                    </Select>
                  </>
                )}

              {/* Background */}
              {mode === 'openai_image_edit' &&
                selectedModelConfig?.background &&
                selectedModelConfig.background.length > 0 && (
                  <>
                    <SettingTitle>{t('paintings.background')}</SettingTitle>
                    <Select
                      value={painting.background}
                      onChange={(value) => updatePaintingState({ background: value })}
                      style={{ width: '100%', marginBottom: 15 }}>
                      {selectedModelConfig.background.map((b) => (
                        <Select.Option value={b.value} key={b.value}>
                          {getPaintingsBackgroundOptionsLabel(b.value) ?? b.value}
                        </Select.Option>
                      ))}
                    </Select>
                  </>
                )}

              {/* Number of Images (n) */}
              {selectedModelConfig?.max_images && (
                <>
                  <SettingTitle>{t('paintings.number_images')}</SettingTitle>
                  <InputNumber
                    min={1}
                    max={selectedModelConfig.max_images}
                    value={painting.n || 1}
                    onChange={handleNChange}
                    style={{ width: '100%', marginBottom: 15 }}
                  />
                </>
              )}
            </>
          )}
        </Scrollbar>
        <div className="flex h-full flex-1 flex-col bg-background">
          {/* 添加功能切换分段控制器 */}
          <div className="flex justify-center pt-6">
            <Segmented shape="round" value={mode} onChange={handleModeChange} options={modeOptions} />
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
        </div>
        <PaintingsList
          namespace={mode}
          paintings={filteredPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      </div>
    </div>
  )
}

export default NewApiPage
