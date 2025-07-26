import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import DMXAPIToImg from '@renderer/assets/images/providers/DMXAPI-to-img.webp'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack, VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { getProviderLabel } from '@renderer/i18n/label'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileMetadata, PaintingsState } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { DmxapiPainting } from '@types'
import { Avatar, Button, Input, Radio, Segmented, Select, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import React, { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { generationModeType } from '../../types'
import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import ImageUploader from './components/ImageUploader'
import PaintingsList from './components/PaintingsList'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  GetModelGroup,
  IMAGE_SIZES,
  MODEOPTIONS,
  STYLE_TYPE_OPTIONS
} from './config/DmxapiConfig'

const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

const DmxapiPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode] = useState<keyof PaintingsState>('DMXAPIPaintings')
  const { DMXAPIPaintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<DmxapiPainting>(DMXAPIPaintings?.[0] || DEFAULT_PAINTING)
  const { theme } = useTheme()
  const { t } = useTranslation()
  const providers = useAllProviders()
  const providerOptions = Options.map((option) => {
    const provider = providers.find((p) => p.id === option)
    if (provider) {
      return {
        label: getProviderLabel(provider.id),
        value: provider.id
      }
    } else {
      return {
        label: 'Unknown Provider',
        value: undefined
      }
    }
  })

  const dmxapiProvider = providers.find((p) => p.id === 'dmxapi')!

  // 动态模型数据状态
  const [dynamicModelGroups, setDynamicModelGroups] = useState<any>(null)
  const [allModels, setAllModels] = useState<any[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
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

  const modeOptions = MODEOPTIONS.map((ele) => {
    return {
      label: t(ele.label),
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
    const currentMode = painting?.generationMode || (MODEOPTIONS[0].value as generationModeType)
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
    updatePainting('DMXAPIPaintings', updatedPainting)
  }

  const getNewPainting = (params?: Partial<DmxapiPainting>) => {
    clearImages()
    const generationMode = params?.generationMode || painting?.generationMode || MODEOPTIONS[0].value
    const modelGroups = getModelOptions(generationMode as generationModeType)
    // 获取第一个非空分组的第一个模型
    let firstModel = ''
    for (const provider of Object.keys(modelGroups)) {
      if (modelGroups[provider].length > 0) {
        firstModel = modelGroups[provider][0].id
        break
      }
    }

    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      seed: generateRandomSeed(),
      generationMode,
      model: firstModel,
      ...params
    }
  }

  const getNewPaintingPanel = (updates: Partial<DmxapiPainting>) => {
    const copyPainting = {
      ...painting,
      ...updates,
      id: uuid()
    }

    setPainting(addPainting('DMXAPIPaintings', copyPainting))
  }

  const onSelectModel = (modelId: string) => {
    const model = allModels.find((m) => m.id === modelId)
    if (model) {
      updatePaintingState({ model: modelId, priceModel: model.price })
    }
  }

  const onCancel = () => {
    abortController?.abort()
  }

  const onSelectImageSize = (v: string) => {
    const size = IMAGE_SIZES.find((i) => i.value === v)
    size && updatePaintingState({ image_size: size.value, aspect_ratio: size.label })
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
    clearImages()
    const newModelGroups = getModelOptions(v)
    setModelOptions(newModelGroups)

    // 获取第一个非空分组的第一个模型
    let firstModel = ''
    let priceModel = ''
    for (const provider of Object.keys(newModelGroups)) {
      if (newModelGroups[provider] && newModelGroups[provider].length > 0) {
        firstModel = newModelGroups[provider][0].id
        priceModel = newModelGroups[provider][0].price
        break
      }
    }

    // 如果有urls，创建新的painting
    if (Array.isArray(painting.urls) && painting.urls.length > 0) {
      const newPainting = getNewPainting({
        generationMode: v,
        model: firstModel, // 使用新模式下的第一个模型
        priceModel: priceModel
      })
      const addedPainting = addPainting('DMXAPIPaintings', newPainting)
      setPainting(addedPainting)
    } else {
      // 否则更新当前painting
      updatePaintingState({
        generationMode: v,
        model: firstModel, // 使用新模式下的第一个模型
        priceModel: priceModel
      })
    }
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

  // 准备V1生成请求函数
  const prepareV1GenerateRequest = (prompt: string, painting: DmxapiPainting) => {
    const params = {
      prompt,
      model: painting.model,
      n: painting.n
    }

    const headerExpand = {
      'Content-Type': 'application/json'
    }

    if (painting.aspect_ratio) {
      params['aspect_ratio'] = painting.aspect_ratio
    }

    if (painting.image_size) {
      params['size'] = painting.image_size
    }

    if (painting.seed) {
      if (Number(painting.seed) >= -1) {
        params['seed'] = Number(painting.seed)
      } else {
        params['seed'] = -1
      }
    }

    if (painting.style_type) {
      params.prompt = prompt + ',风格：' + painting.style_type
    }

    return {
      body: JSON.stringify(params),
      headerExpand: headerExpand,
      endpoint: `${dmxapiProvider.apiHost}/v1/images/generations`
    }
  }

  // 准备V2生成请求函数
  const prepareV2GenerateRequest = (prompt: string, painting: DmxapiPainting) => {
    const params = {
      prompt,
      n: painting.n,
      model: painting.model
    }

    if (painting.image_size) {
      params['size'] = '1024x1024'
    }

    if (painting.style_type) {
      params.prompt = prompt + ',风格：' + painting.style_type
    }

    const formData = new FormData()

    for (const key in params) {
      formData.append(key, params[key])
    }

    if (Array.isArray(fileMap.imageFiles)) {
      fileMap.imageFiles.forEach((file) => {
        formData.append(`image`, file as unknown as Blob)
      })
    }

    return {
      body: formData,
      endpoint: `${dmxapiProvider.apiHost}/v1/images/edits`
    }
  }

  // API请求函数
  const callApi = async (
    requestConfig: { endpoint: string; body: any; headerExpand?: any },
    controller: AbortController
  ) => {
    const { endpoint, body, headerExpand } = requestConfig

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${dmxapiProvider.apiKey}`,
      'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
      ...headerExpand
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('paintings.req_error_token')
      } else if (response.status === 403) {
        throw new Error('paintings.req_error_no_balance')
      }

      throw new Error('操作失败,请稍后重试')
    }

    const data = await response.json()

    return data.data.map((item: { url: string; b64_json: string }) => {
      if (item.b64_json) {
        return 'data:image/png;base64,' + item.b64_json
      }

      if (item.url) {
        return item.url
      }

      return ''
    })
  }

  // 下载图像函数
  const downloadImages = async (urls: string[]) => {
    return Promise.all(
      urls.map(async (url) => {
        try {
          if (!url || url.trim() === '') {
            window.message.warning({
              content: t('message.empty_url'),
              key: 'empty-url-warning'
            })
            return null
          }
          return await window.api.file.download(url, true)
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes('Failed to parse URL') || error.message.includes('Invalid URL'))
          ) {
            window.message.warning({
              content: t('message.empty_url'),
              key: 'empty-url-warning'
            })
          }
          return null
        }
      })
    )
  }

  // 准备请求配置函数
  const prepareRequestConfig = (prompt: string, painting: DmxapiPainting) => {
    // 根据模式和模型版本返回不同的请求配置
    if (
      painting.generationMode !== undefined &&
      [generationModeType.MERGE, generationModeType.EDIT].includes(painting.generationMode)
    ) {
      return prepareV2GenerateRequest(prompt, painting)
    } else {
      return prepareV1GenerateRequest(prompt, painting)
    }
  }

  const onGenerate = async () => {
    // 如果已经在生成过程中，直接返回
    if (isLoading) {
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

      setIsLoading(true)

      // 设置请求状态
      const controller = new AbortController()
      setAbortController(controller)
      dispatch(setGenerating(true))

      // 准备请求配置
      const requestConfig = prepareRequestConfig(prompt, painting)

      // 发送API请求
      const urls = await callApi(requestConfig, controller)

      // 下载图像
      if (urls.length > 0) {
        const downloadedFiles = await downloadImages(urls)
        const validFiles = downloadedFiles.filter((file): file is FileMetadata => file !== null)

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
          window.message.warning({
            content: t('paintings.req_error_text'),
            key: 'empty-url-warning'
          })
        }
      }
    } catch (error) {
      // 错误处理
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content:
            error.message.startsWith('paintings.') || error.message.startsWith('error.')
              ? t(error.message)
              : t('paintings.req_error_text'),
          centered: true
        })
      }
    } finally {
      // 清理状态
      setIsLoading(false)
      dispatch(setGenerating(false))
      setAbortController(null)
    }
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const onDeletePainting = async (paintingToDelete: DmxapiPainting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = DMXAPIPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(DMXAPIPaintings[currentIndex - 1])
      } else if (DMXAPIPaintings.length > 1) {
        setPainting(DMXAPIPaintings[1])
      }
    }

    // 删除绘画
    await removePainting(mode, paintingToDelete)

    // 检查是否删除空了
    if (!DMXAPIPaintings || DMXAPIPaintings.length === 1) {
      // 如果删除后没有绘画了，创建一个新的
      const newPainting = getNewPainting()
      const addedPainting = addPainting('DMXAPIPaintings', newPainting)
      setPainting(addedPainting)
    }
  }

  const onSelectPainting = (newPainting: DmxapiPainting) => {
    if (generating) return
    clearImages()
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      navigate('../' + providerId, { replace: true })
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
          <EmptyImgBox>
            <EmptyImg bgUrl={fileMap.paths[0]}></EmptyImg>
          </EmptyImgBox>
        )
      }
    }

    if (painting?.urls?.length > 0 || DMXAPIPaintings?.length > 1) {
      return null
    } else {
      return (
        <EmptyImgBox>
          <EmptyImg></EmptyImg>
        </EmptyImgBox>
      )
    }
  }

  const defaultLoadText = () => {
    if (
      painting.generationMode &&
      [generationModeType.EDIT, generationModeType.MERGE].includes(painting.generationMode)
    ) {
      return (
        <LoadTextWrap>
          <div>
            正在用使用官方的模型生产，
            <br />
            预计等待2~5分钟效果最好，
            <br />
            本次消耗金额请到DMXAPI后台日志查看
          </div>
        </LoadTextWrap>
      )
    }

    return null
  }

  useEffect(() => {
    loadModelData().then(() => {})
  }, [])

  useEffect(() => {
    if (isLoadingModels || !dynamicModelGroups) {
      return
    }

    if (!DMXAPIPaintings || DMXAPIPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('DMXAPIPaintings', newPainting)
      setPainting(newPainting)
    } else if (painting && !painting.generationMode) {
      // 如果当前painting没有generationMode，添加默认值
      const updatedPainting = { ...painting, generationMode: MODEOPTIONS[0].value }
      setPainting(updatedPainting)
      updatePainting('DMXAPIPaintings', updatedPainting)
    }

    // 确保所有paintings都有generationMode属性
    DMXAPIPaintings.forEach((p) => {
      if (!p.generationMode) {
        const updatedPainting = { ...p, generationMode: MODEOPTIONS[0].value }
        updatePainting('DMXAPIPaintings', updatedPainting)
      }
    })

    // 确保modelOptions与当前painting的generationMode保持一致
    if (painting?.generationMode) {
      setModelOptions(getModelOptions(painting.generationMode as generationModeType))
    }

    // 如果当前painting没有model，设置默认模型
    if (painting && !painting.model && allModels.length > 0) {
      const currentMode = painting.generationMode || MODEOPTIONS[0].value
      const modelGroups = getModelOptions(currentMode as generationModeType)
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

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              className="nodrag"
              icon={<PlusOutlined />}
              onClick={() => setPainting(addPainting('DMXAPIPaintings', getNewPainting()))}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <ProviderTitleContainer>
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href={COURSE_URL}>
              {t('paintings.paint_course')}
              <ProviderLogo
                shape="square"
                src={getProviderLogo(dmxapiProvider.id)}
                size={16}
                style={{ marginLeft: 5 }}
              />
            </SettingHelpLink>
          </ProviderTitleContainer>
          <Select value={providerOptions[2].value} onChange={handleProviderChange} style={{ marginBottom: 15 }}>
            {providerOptions.map((provider) => (
              <Select.Option value={provider.value} key={provider.value}>
                <SelectOptionContainer>
                  <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
                  {provider.label}
                </SelectOptionContainer>
              </Select.Option>
            ))}
          </Select>
          {painting.generationMode &&
            [generationModeType.EDIT, generationModeType.MERGE].includes(painting.generationMode) && (
              <>
                <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>参考图</SettingTitle>
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

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('common.model')} <SettingPrice>{painting.priceModel !== '0' ? painting.priceModel : ''}</SettingPrice>
          </SettingTitle>
          <Select
            value={painting.model}
            onChange={onSelectModel}
            style={{ width: '100%' }}
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

          {painting.generationMode === generationModeType.GENERATION && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
              <Radio.Group
                value={painting.image_size}
                onChange={(e) => onSelectImageSize(e.target.value)}
                style={{ display: 'flex' }}>
                {IMAGE_SIZES.map((size) => (
                  <RadioButton value={size.value} key={size.value}>
                    <VStack alignItems="center">
                      <ImageSizeImage src={size.icon} theme={theme} />
                      <span>{size.label}</span>
                    </VStack>
                  </RadioButton>
                ))}
              </Radio.Group>

              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
                {t('paintings.seed')}
                <Tooltip title={t('paintings.seed_desc_tip')}>
                  <InfoIcon />
                </Tooltip>
              </SettingTitle>
              <Input
                value={painting.seed}
                pattern="[0-9]*"
                onChange={(e) => onInputSeed(e)}
                suffix={
                  <RedoOutlined
                    onClick={() => updatePaintingState({ seed: Math.floor(Math.random() * 1000000).toString() })}
                    style={{ cursor: 'pointer', color: 'var(--color-text-2)' }}
                  />
                }
              />
            </>
          )}

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.style_type')}</SettingTitle>
          <SliderContainer>
            <RadioTextBox>
              {STYLE_TYPE_OPTIONS.map((ele) => (
                <RadioTextItem
                  key={ele.label}
                  className={painting.style_type === ele.label ? 'selected' : ''}
                  onClick={() => onSelectStyleType(ele.label)}>
                  {ele.label}
                </RadioTextItem>
              ))}
            </RadioTextBox>
          </SliderContainer>

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
            {t('paintings.auto_create_paint')}
            <Tooltip title={t('paintings.auto_create_paint_tip')}>
              <InfoIcon />
            </Tooltip>
          </SettingTitle>
          <HStack>
            <Switch checked={painting.autoCreate} onChange={(checked) => onChangeAutoCreate(checked)} />
          </HStack>
        </LeftContainer>
        <MainContainer>
          <ModeSegmentedContainer>
            <Segmented
              shape="round"
              value={painting.generationMode}
              onChange={onGenerationModeChange}
              options={modeOptions}
            />
          </ModeSegmentedContainer>
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
          <InputContainer>
            <Textarea
              ref={textareaRef}
              variant="borderless"
              disabled={isLoading}
              value={painting.prompt}
              spellCheck={false}
              onChange={(e) => updatePaintingState({ prompt: e.target.value })}
              placeholder={t('paintings.prompt_placeholder')}
            />
            <Toolbar>
              <ToolbarMenu>
                <SendMessageButton sendMessage={onGenerate} disabled={isLoading} />
              </ToolbarMenu>
            </Toolbar>
          </InputContainer>
        </MainContainer>
        <PaintingsList
          namespace="DMXAPIPaintings"
          paintings={DMXAPIPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={() => setPainting(addPainting('DMXAPIPaintings', getNewPainting()))}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

// 添加新的样式组件
const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
`

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`
const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: 100%;
  background-color: var(--color-background);
  overflow: hidden;
`

const LeftContainer = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  background-color: var(--color-background);
  max-width: var(--assistants-width);
  border-right: 0.5px solid var(--color-border);
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background);
`

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 95px;
  max-height: 95px;
  position: relative;
  border: 1px solid var(--color-border-soft);
  transition: all 0.3s ease;
  margin: 0 20px 15px 20px;
  border-radius: 10px;
`

const Textarea = styled(TextArea)`
  padding: 10px;
  border-radius: 0;
  display: flex;
  flex: 1;
  resize: none !important;
  overflow: auto;
  width: auto;
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  padding: 0 8px;
  height: 40px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  margin-top: 8px;
`

const RadioButton = styled(Radio.Button)`
  width: 30px;
  height: 55px;
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
`

const InfoIcon = styled(Info)`
  margin-left: 5px;
  cursor: help;
  color: var(--color-text-2);
  opacity: 0.6;
  width: 16px;
  height: 16px;

  &:hover {
    opacity: 1;
  }
`

const SliderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;

  .ant-slider {
    flex: 1;
  }
`

const RadioTextBox = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
`

const RadioTextItem = styled.div`
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  transition: all 0.2s ease;
  border: 1px solid var(--color-border);

  /* 默认状态 */
  background-color: var(--color-background);

  /* 悬浮状态 */
  &:hover {
    background-color: var(--color-hover, #f0f0f0);
  }

  /* 选中状态 - 需要添加selected类名 */
  &.selected {
    background-color: var(--color-primary, #1890ff);
    color: white;
    border: 1px solid var(--color-primary, #1890ff);
  }
`

// 添加新的样式组件
const ModeSegmentedContainer = styled.div`
  display: flex;
  justify-content: center;
  padding-top: 24px;
`

const EmptyImgBox = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  align-items: center;
`

const EmptyImg = styled.div<{ bgUrl?: string }>`
  width: 70vh;
  height: 70vh;
  background-size: cover;
  background-image: ${(props) => (props.bgUrl ? `url(${props.bgUrl})` : `url(${DMXAPIToImg})`)};
`

const LoadTextWrap = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: black;
  text-shadow:
    -1px -1px 0 #ffffff,
    1px -1px 0 #ffffff,
    -1px 1px 0 #ffffff,
    1px 1px 0 #ffffff;
`

const SettingPrice = styled.div`
  margin-left: auto;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 500;
`

export default DmxapiPage
