import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileMetadata } from '@renderer/types'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, Input, InputNumber, Radio, Segmented, Select, Slider, Switch, Tooltip, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingsList from './components/PaintingsList'
import { type ConfigItem, createModeConfigs, DEFAULT_PAINTING } from './config/aihubmixConfig'

const logger = loggerService.withContext('AihubmixPage')

// 使用函数创建配置项
const modeConfigs = createModeConfigs()

const AihubmixPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<keyof PaintingsState>('generate')
  const { addPainting, removePainting, updatePainting, persistentData } = usePaintings()
  const filteredPaintings = useMemo(() => persistentData[mode] || [], [persistentData, mode])
  const [painting, setPainting] = useState<PaintingAction>(filteredPaintings[0] || DEFAULT_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [fileMap, setFileMap] = useState<{ [key: string]: FileMetadata }>({})

  const { t } = useTranslation()
  const { theme } = useTheme()
  const providers = useAllProviders()
  const providerOptions = Options.map((option) => {
    const provider = providers.find((p) => p.id === option)
    return {
      label: t(`provider.${provider?.id}`),
      value: provider?.id
    }
  })
  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const aihubmixProvider = providers.find((p) => p.id === 'aihubmix')!

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'generate' },
    { label: t('paintings.mode.remix'), value: 'remix' },
    { label: t('paintings.mode.upscale'), value: 'upscale' }
  ]

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_PAINTING,
      model: mode === 'generate' ? 'gpt-image-1' : 'V_3',
      id: uuid()
    }
  }, [mode])

  const textareaRef = useRef<any>(null)

  const updatePaintingState = (updates: Partial<PaintingAction>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting(mode, updatedPainting)
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
            logger.error('图像URL为空，可能是提示词违禁')
            window.message.warning({
              content: t('message.empty_url'),
              key: 'empty-url-warning'
            })
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          logger.error('下载图像失败:', error as Error)
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

    return downloadedFiles.filter((file): file is FileMetadata => file !== null)
  }

  const onGenerate = async () => {
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

    if (!aihubmixProvider.enabled) {
      window.modal.error({
        content: t('error.provider_disabled'),
        centered: true
      })
      return
    }

    if (!aihubmixProvider.apiKey) {
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
    dispatch(setGenerating(true))

    let body: string | FormData = ''
    let headers: Record<string, string> = {
      'Api-Key': aihubmixProvider.apiKey
    }
    let url = aihubmixProvider.apiHost + `/ideogram/` + mode

    try {
      if (mode === 'generate') {
        if (painting.model.startsWith('imagen-')) {
          const AI = new AiProvider(aihubmixProvider)
          const base64s = await AI.generateImage({
            prompt,
            model: painting.model,
            imageSize: painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
            batchSize: painting.model.startsWith('imagen-4.0-ultra-generate') ? 1 : painting.numberOfImages || 1,
            personGeneration: painting.personGeneration
          })
          if (base64s?.length > 0) {
            const validFiles = await Promise.all(
              base64s.map(async (base64) => {
                return await window.api.file.saveBase64Image(base64)
              })
            )
            await FileManager.addFiles(validFiles)
            updatePaintingState({ files: validFiles, urls: validFiles.map((file) => file.name) })
          }
          return
        } else if (painting.model === 'V_3') {
          // V3 API uses different endpoint and parameters format
          const formData = new FormData()
          formData.append('prompt', prompt)

          // 确保渲染速度参数正确传递
          const renderSpeed = painting.renderingSpeed || 'DEFAULT'
          logger.silly(`使用渲染速度: ${renderSpeed}`)
          formData.append('rendering_speed', renderSpeed)

          formData.append('num_images', String(painting.numImages || 1))

          // Convert aspect ratio format from ASPECT_1_1 to 1x1 for V3 API
          if (painting.aspectRatio) {
            const aspectRatioValue = painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase()
            logger.silly(`转换后的宽高比: ${aspectRatioValue}`)
            formData.append('aspect_ratio', aspectRatioValue)
          }

          if (painting.styleType && painting.styleType !== 'AUTO') {
            // 确保样式类型与API文档一致，保持大写形式
            // V3 API支持的样式类型: AUTO, GENERAL, REALISTIC, DESIGN
            const styleType = painting.styleType
            logger.silly(`使用样式类型: ${styleType}`)
            formData.append('style_type', styleType)
          } else {
            // 确保明确设置默认样式类型
            logger.silly('使用默认样式类型: AUTO')
            formData.append('style_type', 'AUTO')
          }

          if (painting.seed) {
            logger.silly(`使用随机种子: ${painting.seed}`)
            formData.append('seed', painting.seed)
          }

          if (painting.negativePrompt) {
            logger.silly(`使用负面提示词: ${painting.negativePrompt}`)
            formData.append('negative_prompt', painting.negativePrompt)
          }

          if (painting.magicPromptOption !== undefined) {
            const magicPrompt = painting.magicPromptOption ? 'ON' : 'OFF'
            logger.silly(`使用魔法提示词: ${magicPrompt}`)
            formData.append('magic_prompt', magicPrompt)
          }

          // 打印所有FormData内容
          logger.silly('FormData内容:')
          for (const pair of formData.entries()) {
            logger.silly(`${pair[0]}: ${pair[1]}`)
          }

          body = formData
          // For V3 endpoints - 使用模板字符串而不是字符串连接
          logger.silly(`API 端点: ${aihubmixProvider.apiHost}/ideogram/v1/ideogram-v3/generate`)

          // 调整请求头，可能需要指定multipart/form-data
          // 注意：FormData会自动设置Content-Type，不应手动设置
          const apiHeaders = { 'Api-Key': aihubmixProvider.apiKey }

          try {
            const response = await fetch(`${aihubmixProvider.apiHost}/ideogram/v1/ideogram-v3/generate`, {
              method: 'POST',
              headers: apiHeaders,
              body
            })

            if (!response.ok) {
              const errorData = await response.json()
              logger.error('V3 API错误:', errorData)
              throw new Error(errorData.error?.message || '生成图像失败')
            }

            const data = await response.json()
            logger.silly(`V3 API响应: ${data}`)
            const urls = data.data.map((item) => item.url)

            if (urls.length > 0) {
              const validFiles = await downloadImages(urls)
              await FileManager.addFiles(validFiles)
              updatePaintingState({ files: validFiles, urls })
            }
            return
          } catch (error: unknown) {
            handleError(error)
          } finally {
            setIsLoading(false)
            dispatch(setGenerating(false))
            setAbortController(null)
          }
        } else {
          let requestData: any = {}
          if (painting.model === 'gpt-image-1') {
            requestData = {
              prompt,
              model: painting.model,
              size: painting.size === 'auto' ? undefined : painting.size,
              n: painting.n,
              quality: painting.quality,
              moderation: painting.moderation
            }
            url = aihubmixProvider.apiHost + `/v1/images/generations`
            headers = {
              Authorization: `Bearer ${aihubmixProvider.apiKey}`
            }
          } else {
            // Existing V1/V2 API
            requestData = {
              image_request: {
                prompt,
                model: painting.model,
                aspect_ratio: painting.aspectRatio,
                num_images: painting.numImages,
                style_type: painting.styleType,
                seed: painting.seed ? +painting.seed : undefined,
                negative_prompt: painting.negativePrompt || undefined,
                magic_prompt_option: painting.magicPromptOption ? 'ON' : 'OFF'
              }
            }
          }
          body = JSON.stringify(requestData)
          headers['Content-Type'] = 'application/json'
        }
      } else if (mode === 'remix') {
        if (!painting.imageFile) {
          window.modal.error({
            content: t('paintings.image_file_required'),
            centered: true
          })
          return
        }
        if (!fileMap[painting.imageFile]) {
          window.modal.error({
            content: t('paintings.image_file_retry'),
            centered: true
          })
          return
        }

        if (painting.model === 'V_3') {
          // V3 Remix API
          const formData = new FormData()
          formData.append('prompt', prompt)
          formData.append('rendering_speed', painting.renderingSpeed || 'DEFAULT')
          formData.append('num_images', String(painting.numImages || 1))

          // Convert aspect ratio format for V3 API
          if (painting.aspectRatio) {
            const aspectRatioValue = painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase()
            formData.append('aspect_ratio', aspectRatioValue)
          }

          if (painting.styleType) {
            formData.append('style_type', painting.styleType)
          }

          if (painting.seed) {
            formData.append('seed', painting.seed)
          }

          if (painting.negativePrompt) {
            formData.append('negative_prompt', painting.negativePrompt)
          }

          if (painting.magicPromptOption !== undefined) {
            formData.append('magic_prompt', painting.magicPromptOption ? 'ON' : 'OFF')
          }

          if (painting.imageWeight) {
            formData.append('image_weight', String(painting.imageWeight))
          }

          // Add the image file
          formData.append('image', fileMap[painting.imageFile] as unknown as Blob)

          body = formData
          // For V3 Remix endpoint
          const response = await fetch(`${aihubmixProvider.apiHost}/ideogram/v1/ideogram-v3/remix`, {
            method: 'POST',
            headers: { 'Api-Key': aihubmixProvider.apiKey },
            body
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('V3 Remix API错误:', errorData)
            throw new Error(errorData.error?.message || '图像混合失败')
          }

          const data = await response.json()
          logger.silly(`V3 Remix API响应: ${data}`)
          const urls = data.data.map((item) => item.url)

          // Handle the downloaded images
          if (urls.length > 0) {
            const validFiles = await downloadImages(urls)
            await FileManager.addFiles(validFiles)
            updatePaintingState({ files: validFiles, urls })
          }
          return
        } else {
          // Existing V1/V2 API for remix
          const form = new FormData()
          const imageRequest: Record<string, any> = {
            prompt,
            model: painting.model,
            aspect_ratio: painting.aspectRatio,
            image_weight: painting.imageWeight,
            style_type: painting.styleType,
            num_images: painting.numImages,
            seed: painting.seed ? +painting.seed : undefined,
            negative_prompt: painting.negativePrompt || undefined,
            magic_prompt_option: painting.magicPromptOption ? 'ON' : 'OFF'
          }
          form.append('image_request', JSON.stringify(imageRequest))
          form.append('image_file', fileMap[painting.imageFile] as unknown as Blob)
          body = form
        }
      } else if (mode === 'upscale') {
        if (!painting.imageFile) {
          window.modal.error({
            content: t('paintings.image_file_required'),
            centered: true
          })
          return
        }
        if (!fileMap[painting.imageFile]) {
          window.modal.error({
            content: t('paintings.image_file_retry'),
            centered: true
          })
          return
        }

        const form = new FormData()
        const imageRequest: Record<string, any> = {
          prompt,
          resemblance: painting.resemblance,
          detail: painting.detail,
          num_images: painting.numImages,
          seed: painting.seed ? +painting.seed : undefined,
          magic_prompt_option: painting.magicPromptOption ? 'AUTO' : 'OFF'
        }
        form.append('image_request', JSON.stringify(imageRequest))
        form.append('image_file', fileMap[painting.imageFile] as unknown as Blob)
        body = form
      }

      // 只针对非V3模型使用通用接口
      if (!painting.model?.includes('V_3') || mode === 'upscale') {
        // 直接调用自定义接口
        const response = await fetch(url, { method: 'POST', headers, body })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('通用API错误:', errorData)
          throw new Error(errorData.error?.message || '生成图像失败')
        }

        const data = await response.json()
        logger.silly(`通用API响应: ${data}`)
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
          updatePaintingState({ files: validFiles, urls: validFiles.map((file) => file.name) })
        }
      }
    } catch (error: unknown) {
      handleError(error)
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
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

    removePainting(mode, paintingToDelete)
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
        translate()
      }
    }
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      navigate('../' + providerId, { replace: true })
    }
  }

  // 处理模式切换
  const handleModeChange = (value: string) => {
    setMode(value as keyof PaintingsState)
    if (persistentData[value as keyof PaintingsState] && persistentData[value as keyof PaintingsState].length > 0) {
      setPainting(persistentData[value as keyof PaintingsState][0])
    } else {
      setPainting(DEFAULT_PAINTING)
    }
  }

  // 处理随机种子的点击事件 >=0<=2147483647
  const handleRandomSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647).toString()
    updatePaintingState({ seed: randomSeed })
    return randomSeed
  }

  // 渲染配置项的函数
  const renderConfigForm = (item: ConfigItem) => {
    switch (item.type) {
      case 'select': {
        // 处理函数类型的disabled属性
        const isDisabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled

        // 处理函数类型的options属性
        const selectOptions =
          typeof item.options === 'function'
            ? item.options(item, painting).map((option) => ({
                ...option,
                label: option.label.startsWith('paintings.') ? t(option.label) : option.label
              }))
            : item.options?.map((option) => ({
                ...option,
                label: option.label.startsWith('paintings.') ? t(option.label) : option.label
              }))

        return (
          <Select
            style={{ width: '100%' }}
            listHeight={500}
            disabled={isDisabled}
            value={painting[item.key!] || item.initialValue}
            options={selectOptions as any}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      }
      case 'radio': {
        // 处理函数类型的options属性
        const radioOptions =
          typeof item.options === 'function'
            ? item.options(item, painting).map((option) => ({
                ...option,
                label: option.label.startsWith('paintings.') ? t(option.label) : option.label
              }))
            : item.options?.map((option) => ({
                ...option,
                label: option.label.startsWith('paintings.') ? t(option.label) : option.label
              }))

        return (
          <Radio.Group
            value={painting[item.key!] || item.initialValue}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}>
            {radioOptions!.map((option) => (
              <Radio.Button key={option.value} value={option.value}>
                {option.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        )
      }
      case 'slider': {
        return (
          <SliderContainer>
            <Slider
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
            <StyledInputNumber
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
          </SliderContainer>
        )
      }
      case 'input':
        return (
          <Input
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            suffix={
              item.key === 'seed' ? (
                <RedoOutlined onClick={handleRandomSeed} style={{ cursor: 'pointer', color: 'var(--color-text-2)' }} />
              ) : (
                item.suffix
              )
            }
          />
        )
      case 'inputNumber':
        return (
          <InputNumber
            min={item.min}
            max={item.max}
            style={{ width: '100%' }}
            value={(painting[item.key!] || item.initialValue) as number}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      case 'textarea':
        return (
          <TextArea
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            spellCheck={false}
            rows={4}
          />
        )
      case 'switch':
        return (
          <HStack>
            <Switch
              checked={(painting[item.key!] || item.initialValue) as boolean}
              onChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </HStack>
        )
      case 'image': {
        return (
          <ImageUploadButton
            accept="image/png, image/jpeg, image/gif"
            maxCount={1}
            showUploadList={false}
            listType="picture-card"
            beforeUpload={(file) => {
              const path = URL.createObjectURL(file)
              setFileMap({ ...fileMap, [path]: file as unknown as FileMetadata })
              updatePaintingState({ [item.key!]: path })
              return false // 阻止默认上传行为
            }}>
            {painting[item.key!] ? (
              <ImagePreview>
                <img src={painting[item.key!]} alt="预览图" />
              </ImagePreview>
            ) : (
              <ImageSizeImage src={IcImageUp} theme={theme} />
            )}
          </ImageUploadButton>
        )
      }
      default:
        return null
    }
  }

  // 渲染配置项的函数
  const renderConfigItem = (item: ConfigItem, index: number) => {
    return (
      <div key={index}>
        <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
          {t(item.title!)}
          {item.tooltip && (
            <Tooltip title={t(item.tooltip)}>
              <InfoIcon />
            </Tooltip>
          )}
        </SettingTitle>
        {renderConfigForm(item)}
      </div>
    )
  }

  const onSelectPainting = (newPainting: PaintingAction) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  useEffect(() => {
    if (filteredPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting(mode, newPainting)
      setPainting(newPainting)
    }
  }, [filteredPaintings, mode, addPainting, painting, getNewPainting])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="small" className="nodrag" icon={<PlusOutlined />} onClick={handleAddPainting}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <ProviderTitleContainer>
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href={aihubmixProvider.apiHost}>
              {t('paintings.learn_more')}
              <ProviderLogo
                shape="square"
                src={getProviderLogo(aihubmixProvider.id)}
                size={16}
                style={{ marginLeft: 5 }}
              />
            </SettingHelpLink>
          </ProviderTitleContainer>

          <Select value={providerOptions[0].value} onChange={handleProviderChange} style={{ marginBottom: 15 }}>
            {providerOptions.map((provider) => (
              <Select.Option value={provider.value} key={provider.value}>
                <SelectOptionContainer>
                  <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
                  {provider.label}
                </SelectOptionContainer>
              </Select.Option>
            ))}
          </Select>

          {/* 使用JSON配置渲染设置项 */}
          {modeConfigs[mode].filter((item) => (item.condition ? item.condition(painting) : true)).map(renderConfigItem)}
        </LeftContainer>
        <MainContainer>
          {/* 添加功能切换分段控制器 */}
          <ModeSegmentedContainer>
            <Segmented shape="round" value={mode} onChange={handleModeChange} options={modeOptions} />
          </ModeSegmentedContainer>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
            retry={handleRetry}
          />
          <InputContainer>
            <Textarea
              ref={textareaRef}
              variant="borderless"
              disabled={isLoading}
              value={painting.prompt}
              spellCheck={false}
              onChange={(e) => updatePaintingState({ prompt: e.target.value })}
              placeholder={
                isTranslating
                  ? t('paintings.translating')
                  : painting.model?.startsWith('imagen-')
                    ? t('paintings.prompt_placeholder_en')
                    : t('paintings.prompt_placeholder_edit')
              }
              onKeyDown={handleKeyDown}
            />
            <Toolbar>
              <ToolbarMenu>
                <TranslateButton
                  text={textareaRef.current?.resizableTextArea?.textArea?.value}
                  onTranslated={(translatedText) => updatePaintingState({ prompt: translatedText })}
                  disabled={isLoading || isTranslating}
                  isLoading={isTranslating}
                  style={{ marginRight: 6, borderRadius: '50%' }}
                />
                <SendMessageButton sendMessage={onGenerate} disabled={isLoading} />
              </ToolbarMenu>
            </Toolbar>
          </InputContainer>
        </MainContainer>
        <PaintingsList
          namespace={mode}
          paintings={filteredPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
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
  justify-content: space-between;
  justify-content: flex-end;
  padding: 0 8px;
  padding-bottom: 0;
  height: 40px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

const InfoIcon = styled(Info)`
  margin-left: 5px;
  cursor: help;
  color: var(--color-text-2);
  opacity: 0.6;
  width: 14px;
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

const StyledInputNumber = styled(InputNumber)`
  width: 70px;
`

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

// 添加新的样式组件
const ModeSegmentedContainer = styled.div`
  display: flex;
  justify-content: center;
  padding-top: 24px;
`

const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

// 添加新的样式组件
const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
`

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  margin-top: 8px;
`

const ImageUploadButton = styled(Upload)`
  & .ant-upload.ant-upload-select,
  .ant-upload-list-item-container {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 !important;
  }
`

// 修改 ImagePreview 组件，添加悬停效果
const ImagePreview = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  border-radius: 6px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &:hover::after {
    content: '点击替换';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
`

export default AihubmixPage
