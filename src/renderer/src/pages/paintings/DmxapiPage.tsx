import { RedoOutlined } from '@ant-design/icons'
import { InfoTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import DMXAPIToImg from '@renderer/assets/images/providers/DMXAPI-to-img.webp'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { classNames, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { DmxapiPainting } from '@types'
import { Input, InputNumber, Segmented, Select } from 'antd'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { generationModeType } from '../../types'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import ImageUploader from './components/ImageUploader'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingImageNavigation } from './hooks/usePaintingImageNavigation'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  GetModelGroup,
  MODEOPTIONS,
  STYLE_TYPE_OPTIONS,
  TOP_UP_URL
} from './providers/dmxapi/config'
import { generateDmxapiImages } from './providers/dmxapi/provider'
import { checkProviderEnabled } from './utils'
import { downloadPaintingUrls } from './utils/imageFiles'

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

const DmxapiPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { dmxapi_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<DmxapiPainting>(dmxapi_paintings?.[0] || DEFAULT_PAINTING)
  const { currentImageIndex, nextImage, prevImage, resetImageIndex } = usePaintingImageNavigation(painting.files.length)
  const { t } = useTranslation()
  const providers = useAllProviders()

  const dmxapiProvider = providers.find((p) => p.id === 'dmxapi')!

  // 动态模型数据状态
  const [dynamicModelGroups, setDynamicModelGroups] = useState<any>(null)
  const [allModels, setAllModels] = useState<any[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)

  const navigate = useNavigate()
  const location = useLocation()

  interface FileMapType {
    imageFiles?: FileMetadata[]
    paths?: string[]
  }

  const [fileMap, setFileMap] = useState<FileMapType>({
    imageFiles: [],
    paths: []
  })

  // 自定义尺寸相关状态
  const [isCustomSize, setIsCustomSize] = useState(false)
  const [customWidth, setCustomWidth] = useState<number | undefined>()
  const [customHeight, setCustomHeight] = useState<number | undefined>()

  const modeOptions = MODEOPTIONS.map((ele) => {
    return {
      label: t(ele.labelKey),
      value: ele.value
    }
  })

  const getModelOptions = (mode: generationModeType) => {
    if (!dynamicModelGroups) {
      return {}
    }

    if (mode === generationModeType.EDIT) {
      return dynamicModelGroups.IMAGE_EDIT || {}
    }

    if (mode === generationModeType.MERGE) {
      return dynamicModelGroups.IMAGE_MERGE || {}
    }

    // 默认情况或其它模式下的选项
    return dynamicModelGroups.TEXT_TO_IMAGES || {}
  }

  const [modelOptions, setModelOptions] = useState(() => {
    // 根据当前painting的generationMode初始化modelOptions
    const currentMode = painting?.generationMode || MODEOPTIONS[0].value
    return getModelOptions(currentMode)
  })

  const textareaRef = useRef<any>(null)

  // 加载模型数据
  const loadModelData = async () => {
    try {
      setIsLoadingModels(true)
      const modelData = await GetModelGroup()
      setDynamicModelGroups(modelData)

      const allModelsList = Object.values(modelData).flatMap((group) => Object.values(group).flat())

      setAllModels(allModelsList)
    } catch (error) {
      // 如果加载失败，可以设置一个默认的空状态
    } finally {
      setIsLoadingModels(false)
    }
  }

  // 更新painting状态的辅助函数
  const updatePaintingState = (updates: Partial<DmxapiPainting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('dmxapi_paintings', updatedPainting)
  }

  const getFirstModelInfo = (v: generationModeType) => {
    const modelGroups = getModelOptions(v)

    let model = ''
    let priceModel = ''
    let image_size = ''
    let extend_params = {}

    for (const provider of Object.keys(modelGroups)) {
      if (modelGroups[provider] && modelGroups[provider].length > 0) {
        model = modelGroups[provider][0].id
        priceModel = modelGroups[provider][0].price
        image_size = modelGroups[provider][0].image_sizes[0].value
        extend_params = modelGroups[provider][0].extend_params
        break
      }
    }

    return {
      model,
      priceModel,
      image_size,
      modelGroups,
      extend_params
    }
  }

  const getNewPainting = (params?: Partial<DmxapiPainting>) => {
    clearImages()

    const generationMode = params?.generationMode || painting?.generationMode || MODEOPTIONS[0].value

    const { model, priceModel, image_size, modelGroups, extend_params } = getFirstModelInfo(generationMode)

    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      seed: generateRandomSeed(),
      generationMode,
      model,
      modelGroups,
      priceModel,
      image_size,
      extend_params,
      ...params
    }
  }

  const getNewPaintingPanel = (updates: Partial<DmxapiPainting>) => {
    const copyPainting = {
      ...painting,
      ...updates,
      id: uuid()
    }

    setPainting(addPainting('dmxapi_paintings', copyPainting))
  }

  const onSelectModel = (modelId: string) => {
    const model = allModels.find((m) => m.id === modelId)
    if (model) {
      updatePaintingState({
        model: modelId,
        priceModel: model.price,
        image_size: model.image_sizes[0].value,
        extend_params: model.extend_params
      })
    }
  }

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') {
      window.modal.error({
        content:
          error.message.startsWith('paintings.') || error.message.startsWith('error.')
            ? t(error.message)
            : t('paintings.req_error_text'),
        centered: true
      })
    }
  }

  const { isLoading, generating, runGeneration, cancelGeneration } = usePaintingGenerationTask({
    onError: handleError
  })

  const onCancel = () => {
    cancelGeneration()
  }

  const onSelectImageSize = (v: string) => {
    if (v === 'custom') {
      setIsCustomSize(true)
      // 如果有自定义尺寸值，使用它们
      if (customWidth && customHeight) {
        updatePaintingState({ image_size: `${customWidth}x${customHeight}`, aspect_ratio: 'custom' })
      }
    } else {
      setIsCustomSize(false)
      const currentModel = allModels.find((m) => m.id === painting.model)
      const size = currentModel?.image_sizes?.find((i) => i.value === v)
      size && updatePaintingState({ image_size: size.value, aspect_ratio: size.label })
    }
  }

  const onCustomSizeChange = (value: number | null, type: string) => {
    if (value === null) return

    if (type === 'width') {
      setCustomWidth(value)
      if (customHeight) {
        updatePaintingState({ image_size: `${value}x${customHeight}`, aspect_ratio: 'custom' })
      }
    } else if (type === 'height') {
      setCustomHeight(value)
      if (customWidth) {
        updatePaintingState({ image_size: `${customWidth}x${value}`, aspect_ratio: 'custom' })
      }
    }
  }

  const onSelectStyleType = (v: string) => {
    if (v === painting.style_type) {
      updatePaintingState({ style_type: '' })
    } else {
      updatePaintingState({ style_type: v })
    }
  }

  const onChangeAutoCreate = (v: boolean) => {
    updatePaintingState({ autoCreate: v })
  }

  const onInputSeed = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // 允许空值或合法整数，且大于等于 -1
    if (value === '' || value === '-' || /^-?\d+$/.test(value)) {
      const numValue = parseInt(value, 10)

      if (numValue >= -1 || value === '' || value === '-') {
        updatePaintingState({ seed: value })
      }
    }
  }

  const onbeforeunload = (file, index?: number) => {
    const path = URL.createObjectURL(file)

    // 更新 fileMap
    setFileMap((prevFileMap) => {
      const currentFiles = prevFileMap.imageFiles || []
      const currentPaths = prevFileMap.paths || []

      let newFiles: FileMetadata[]
      let newPaths: string[]

      if (index !== undefined) {
        // 替换指定索引的图片
        newFiles = [...currentFiles]
        newFiles[index] = file as FileMetadata

        newPaths = [...currentPaths]
        newPaths[index] = path
      } else {
        // 添加新图片到最后
        newFiles = [...currentFiles, file as FileMetadata]
        newPaths = [...currentPaths, path]
      }

      return {
        imageFiles: newFiles,
        paths: newPaths
      }
    })

    return false // 阻止默认上传行为
  }

  const onGenerationModeChange = (v: generationModeType) => {
    if (isLoading) {
      return
    }

    clearImages()

    const { model, priceModel, image_size, modelGroups, extend_params } = getFirstModelInfo(v)

    setModelOptions(modelGroups)

    // 如果有urls，创建新的painting
    if (Array.isArray(painting.urls) && painting.urls.length > 0) {
      const newPainting = getNewPainting({
        generationMode: v,
        model
      })
      const addedPainting = addPainting('dmxapi_paintings', newPainting)
      setPainting(addedPainting)
    } else {
      // 否则更新当前painting
      updatePaintingState({
        generationMode: v,
        model,
        image_size,
        priceModel,
        extend_params
      })
    }
  }

  const createNewPainting = () => {
    if (isLoading) {
      return
    }
    setPainting(addPainting('dmxapi_paintings', getNewPainting()))
  }

  // 检查提供者状态函数
  const checkProviderStatus = () => {
    if (!dmxapiProvider.enabled) {
      throw new Error('error.provider_disabled')
    }

    if (!dmxapiProvider.apiKey) {
      throw new Error('error.no_api_key')
    }

    if (!painting.model) {
      throw new Error('error.missing_required_fields')
    }

    if (!painting.prompt) {
      throw new Error('paintings.text_desc_required')
    }

    if (
      painting.generationMode &&
      [generationModeType.EDIT, generationModeType.MERGE].includes(painting.generationMode) &&
      (!fileMap.imageFiles || fileMap.imageFiles.length === 0)
    ) {
      throw new Error('paintings.image_handle_required')
    }
  }

  const onGenerate = async () => {
    // 如果已经在生成过程中，直接返回
    if (isLoading) {
      return
    }

    if (!dmxapiProvider.enabled) {
      void checkProviderEnabled(dmxapiProvider, t)
      return
    }

    try {
      // 获取提示词
      const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''
      updatePaintingState({ prompt })

      // 检查提供者状态
      checkProviderStatus()

      // 处理已有文件
      if (painting.files.length > 0 && !painting.autoCreate) {
        const confirmed = await window.modal.confirm({
          content: t('paintings.regenerate.confirm'),
          centered: true
        })
        if (!confirmed) return
      }

      await runGeneration(async (signal) => {
        const result = await generateDmxapiImages({
          provider: dmxapiProvider,
          painting,
          prompt,
          fileMap,
          stylePromptPrefix: t('paintings.dmxapi.style'),
          signal
        })

        // 下载图像
        const { urls } = result
        if (urls.length > 0) {
          const validFiles = await downloadPaintingUrls(urls, {
            t,
            forceDownload: true,
            saveDataImage: true
          })

          if (validFiles?.length > 0) {
            if (painting.autoCreate && painting.files.length > 0) {
              // 保存文件并更新状态
              await FileManager.addFiles(validFiles)
              getNewPaintingPanel({ files: validFiles, urls })
            } else {
              // 删除之前的图片
              await FileManager.deleteFiles(painting.files)

              // 保存文件并更新状态
              await FileManager.addFiles(validFiles)
              updatePaintingState({ files: validFiles, urls })
            }
          } else {
            window.toast.warning(t('paintings.req_error_text'))
          }
        }
      })
    } catch (error) {
      handleError(error)
    }
  }

  const onDeletePainting = async (paintingToDelete: DmxapiPainting) => {
    if (paintingToDelete.id === painting.id) {
      if (isLoading) {
        return
      }

      const currentIndex = dmxapi_paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(dmxapi_paintings[currentIndex - 1])
      } else if (dmxapi_paintings.length > 1) {
        setPainting(dmxapi_paintings[1])
      }
    }

    // 删除绘画
    await removePainting('dmxapi_paintings', paintingToDelete)

    // 检查是否删除空了
    if (!dmxapi_paintings || dmxapi_paintings.length === 1) {
      // 如果删除后没有绘画了，创建一个新的
      const newPainting = getNewPainting()
      const addedPainting = addPainting('dmxapi_paintings', newPainting)
      setPainting(addedPainting)
    }
  }

  const onSelectPainting = (newPainting: DmxapiPainting) => {
    if (generating) return
    clearImages()
    setPainting(newPainting)
    resetImageIndex()
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  // 清除图片函数
  const clearImages = () => {
    setFileMap(() => ({ paths: [], imageFiles: [] }))
  }

  const handleDeleteImage = (index: number) => {
    setFileMap((prevFileMap) => {
      const newPaths = [...(prevFileMap.paths || [])]
      const newImageFiles = [...(prevFileMap.imageFiles || [])]

      // 删除指定索引的图片
      newPaths.splice(index, 1)
      newImageFiles.splice(index, 1)

      return {
        paths: newPaths,
        imageFiles: newImageFiles
      }
    })
  }

  // 定义大图的默认图片
  const defaultCoverImage = () => {
    if (painting.generationMode === generationModeType.EDIT) {
      if (painting?.urls.length === 0 && fileMap.paths && fileMap.paths?.length > 0 && fileMap.paths[0]) {
        return (
          <div className="flex flex-1 flex-row items-center justify-center">
            <div
              className="h-[70vh] w-[70vh] bg-center bg-contain bg-white bg-no-repeat"
              style={{ backgroundImage: `url(${fileMap.paths[0]})` }}
            />
          </div>
        )
      }
    }

    if (painting?.urls?.length > 0 || dmxapi_paintings?.length > 1) {
      return null
    } else {
      return (
        <div className="flex flex-1 flex-row items-center justify-center">
          <div
            className="h-[70vh] w-[70vh] bg-center bg-contain bg-white bg-no-repeat"
            style={{ backgroundImage: `url(${DMXAPIToImg})` }}
          />
        </div>
      )
    }
  }

  const defaultLoadText = () => {
    if (
      painting.generationMode &&
      [generationModeType.EDIT, generationModeType.MERGE].includes(painting.generationMode)
    ) {
      return (
        <div className="flex flex-col items-center justify-center text-center text-black [text-shadow:-1px_-1px_0_#ffffff,1px_-1px_0_#ffffff,-1px_1px_0_#ffffff,1px_1px_0_#ffffff]">
          <div>{t('paintings.dmxapi.generating_tip')}</div>
        </div>
      )
    }

    return null
  }

  useEffect(() => {
    void loadModelData().then(() => {})
  }, [])

  useEffect(() => {
    if (isLoadingModels || !dynamicModelGroups) {
      return
    }

    if (!dmxapi_paintings || dmxapi_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('dmxapi_paintings', newPainting)
      setPainting(newPainting)
    } else if (painting && !painting.generationMode) {
      // 如果当前painting没有generationMode，添加默认值
      const updatedPainting = { ...painting, generationMode: MODEOPTIONS[0].value }
      setPainting(updatedPainting)
      updatePainting('dmxapi_paintings', updatedPainting)
    }

    // 确保所有paintings都有generationMode属性
    dmxapi_paintings.forEach((p) => {
      if (!p.generationMode) {
        const updatedPainting = { ...p, generationMode: MODEOPTIONS[0].value }
        updatePainting('dmxapi_paintings', updatedPainting)
      }
    })

    // 确保modelOptions与当前painting的generationMode保持一致
    if (painting?.generationMode) {
      setModelOptions(getModelOptions(painting.generationMode))
    }

    // 如果当前painting没有model，设置默认模型
    if (painting && !painting.model && allModels.length > 0) {
      const currentMode = painting.generationMode || MODEOPTIONS[0].value
      const modelGroups = getModelOptions(currentMode)
      let firstModel = ''
      let priceModel = ''
      for (const provider of Object.keys(modelGroups)) {
        if (modelGroups[provider] && modelGroups[provider].length > 0) {
          firstModel = modelGroups[provider][0].id
          priceModel = modelGroups[provider][0].price
          break
        }
      }
      if (firstModel) {
        updatePaintingState({ model: firstModel, priceModel: priceModel })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingModels, dynamicModelGroups]) // 依赖模型加载状态

  // 当模型切换时，检查是否支持自定义尺寸
  useEffect(() => {
    const currentModel = allModels.find((m) => m.id === painting.model)
    if (currentModel && !currentModel.is_custom_size && isCustomSize) {
      setIsCustomSize(false)
    }
  }, [painting.model, allModels, isCustomSize])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={createNewPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          <div className="mb-1.25 flex flex-row items-center justify-between">
            <SettingTitle className="mb-1">{t('common.provider')}</SettingTitle>
            <div className="flex flex-row items-center gap-2">
              <SettingHelpLink target="_blank" href={COURSE_URL}>
                {t('paintings.paint_course')}
              </SettingHelpLink>
              <SettingHelpLink target="_blank" href={TOP_UP_URL}>
                {t('paintings.top_up')}
              </SettingHelpLink>
              {(() => {
                const Icon = resolveProviderIcon(dmxapiProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-1" /> : null
              })()}
            </div>
          </div>
          <ProviderSelect
            provider={dmxapiProvider}
            options={Options}
            onChange={handleProviderChange}
            className="mb-4"
          />
          {painting.generationMode &&
            [generationModeType.EDIT, generationModeType.MERGE].includes(painting.generationMode) && (
              <>
                <SettingTitle className="mt-4 mb-1">{t('paintings.remix.image_file')}</SettingTitle>
                <ImageUploader
                  fileMap={fileMap}
                  maxImages={painting.generationMode === generationModeType.EDIT ? 1 : 3}
                  onClearImages={clearImages}
                  onDeleteImage={handleDeleteImage}
                  onAddImage={onbeforeunload}
                  mode={painting.generationMode}
                />
              </>
            )}

          <SettingTitle className="mt-4 mb-1">
            {t('common.model')}{' '}
            <div className="ml-auto font-medium text-[11px] text-primary">
              {painting.priceModel !== '0' ? painting.priceModel : ''}
            </div>
          </SettingTitle>
          <Select
            value={painting.model}
            onChange={onSelectModel}
            className="w-full"
            loading={isLoadingModels}
            placeholder={isLoadingModels ? t('common.loading') : t('paintings.select_model')}>
            {Object.entries(modelOptions).map(([provider, models]) => {
              if ((models as any[]).length === 0) return null
              return (
                <Select.OptGroup label={provider} key={provider}>
                  {(models as any[]).map((model) => (
                    <Select.Option key={model.id} value={model.id}>
                      {model.name}
                    </Select.Option>
                  ))}
                </Select.OptGroup>
              )
            })}
          </Select>

          <SettingTitle className="mt-4 mb-1">{t('paintings.image.size')}</SettingTitle>
          <Select
            value={isCustomSize ? 'custom' : painting.image_size}
            onChange={(value) => onSelectImageSize(value)}
            className="w-full">
            {(() => {
              const currentModel = allModels.find((m) => m.id === painting.model)
              const modelImageSizes = currentModel?.image_sizes || []

              // 直接使用模型返回的image_sizes数据，包含label和value
              return modelImageSizes.map((size) => {
                return (
                  <Select.Option key={size.value} value={size.value}>
                    <RowFlex className="items-center gap-2">
                      <span>{size.label}</span>
                    </RowFlex>
                  </Select.Option>
                )
              })
            })()}
            {/* 检查当前模型是否支持自定义尺寸 */}
            {allModels.find((m) => m.id === painting.model)?.is_custom_size && (
              <Select.Option value="custom" key="custom">
                <RowFlex className="items-center gap-2">
                  <span>{t('paintings.custom_size')}</span>
                </RowFlex>
              </Select.Option>
            )}
          </Select>

          {/* 自定义尺寸输入框 */}
          {isCustomSize && allModels.find((m) => m.id === painting.model)?.is_custom_size && (
            <div className="mt-2.5">
              <RowFlex className="items-center gap-2">
                <InputNumber
                  placeholder="W"
                  value={customWidth}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value, 'width')}
                  min={parseInt(allModels.find((m) => m.id === painting.model)?.min_image_size || '512')}
                  max={parseInt(allModels.find((m) => m.id === painting.model)?.max_image_size || '2048')}
                  className="w-20 flex-1"
                />
                <span className="text-foreground-secondary text-xs">x</span>
                <InputNumber
                  placeholder="H"
                  value={customHeight}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value, 'height')}
                  min={parseInt(allModels.find((m) => m.id === painting.model)?.min_image_size || 512)}
                  max={parseInt(allModels.find((m) => m.id === painting.model)?.max_image_size || 2048)}
                  className="w-20 flex-1"
                />
                <span className="text-[11px] text-foreground-muted">px</span>
              </RowFlex>
            </div>
          )}

          {painting.generationMode === generationModeType.GENERATION && (
            <>
              <SettingTitle className="mt-4 mb-1">
                {t('paintings.seed')}
                <InfoTooltip content={t('paintings.seed_desc_tip')} />
              </SettingTitle>
              <Input
                value={painting.seed}
                pattern="[0-9]*"
                onChange={(e) => onInputSeed(e)}
                suffix={
                  <RedoOutlined
                    onClick={() => updatePaintingState({ seed: Math.floor(Math.random() * 1000000).toString() })}
                    className="cursor-pointer text-foreground-secondary"
                  />
                }
              />
            </>
          )}

          <SettingTitle className="mt-4 mb-1">{t('paintings.style_type')}</SettingTitle>
          <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
            <div className="flex flex-wrap items-start gap-2">
              {STYLE_TYPE_OPTIONS.map((ele) => (
                <div
                  key={ele.value}
                  className={classNames(
                    'cursor-pointer rounded-md px-1.5 py-0.5 transition-all duration-200',
                    painting.style_type === ele.value
                      ? 'border border-primary bg-primary text-primary-foreground'
                      : 'border border-border bg-background hover:bg-accent'
                  )}
                  onClick={() => onSelectStyleType(ele.value)}>
                  {t(ele.labelKey)}
                </div>
              ))}
            </div>
          </div>

          <SettingTitle className="mt-4 mb-1">
            {t('paintings.auto_create_paint')}
            <InfoTooltip content={t('paintings.auto_create_paint_tip')} />
          </SettingTitle>
          <RowFlex>
            <Switch checked={painting.autoCreate} onCheckedChange={(checked) => onChangeAutoCreate(checked)} />
          </RowFlex>
        </>
      }
      artboard={
        <>
          <div className="flex justify-center pt-6">
            <Segmented
              shape="round"
              value={painting.generationMode}
              onChange={onGenerationModeChange}
              options={modeOptions}
            />
          </div>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
            imageCover={defaultCoverImage()}
            loadText={defaultLoadText()}
          />
        </>
      }
      promptBar={
        <PaintingPromptBar
          textareaRef={textareaRef}
          value={painting.prompt}
          disabled={isLoading}
          placeholder={t('paintings.prompt_placeholder')}
          onChange={(prompt) => updatePaintingState({ prompt })}
          onGenerate={onGenerate}
          footerClassName="flex h-10 flex-row justify-end px-2"
          actionsClassName="flex flex-row items-center gap-1.5"
        />
      }
      history={
        <PaintingsList
          namespace="dmxapi_paintings"
          paintings={dmxapi_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={createNewPainting}
        />
      }
    />
  )
}

export default DmxapiPage
