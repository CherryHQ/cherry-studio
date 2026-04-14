import { PlusOutlined } from '@ant-design/icons'
import { Button, InfoTooltip, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
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
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata } from '@renderer/types'
import type { PaintingAction } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { PaintingConfigFieldRenderer } from './components/PaintingConfigFieldRenderer'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { type AihubmixMode, type ConfigItem, createModeConfigs, DEFAULT_PAINTING } from './config/aihubmixConfig'
import { checkProviderEnabled } from './utils'

const logger = loggerService.withContext('AihubmixPage')

// 使用函数创建配置项
const modeConfigs = createModeConfigs()

type AihubmixPaintingMode = 'generate' | 'remix' | 'upscale'

const MODE_TO_CONFIG: Record<AihubmixPaintingMode, AihubmixMode> = {
  generate: 'aihubmix_image_generate',
  remix: 'aihubmix_image_remix',
  upscale: 'aihubmix_image_upscale'
}

const AihubmixPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<AihubmixPaintingMode>('generate')

  const { t } = useTranslation()
  const { theme } = useTheme()
  const providers = useAllProviders()
  const aihubmixProvider = providers.find((p) => p.id === 'aihubmix')!

  const {
    items: filteredPaintings,
    add: addPainting,
    remove: removePainting,
    update: updatePaintingRecord,
    reorder
  } = usePaintingList({ providerId: 'aihubmix', mode })
  const [painting, setPainting] = useState<PaintingAction>(filteredPaintings[0] || DEFAULT_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [fileMap, setFileMap] = useState<{ [key: string]: FileMetadata }>({})

  const [generating, setGenerating] = useCache('chat.generating')
  const navigate = useNavigate()
  const location = useLocation()
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'generate' },
    { label: t('paintings.mode.remix'), value: 'remix' },
    { label: t('paintings.mode.upscale'), value: 'upscale' }
  ]

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_PAINTING,
      model: mode === 'generate' ? 'gemini-3-pro-image-preview' : 'V_3',
      id: uuid()
    }
  }, [mode])

  const updatePaintingState = (updates: Partial<PaintingAction>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePaintingRecord(updatedPainting)
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
    await checkProviderEnabled(aihubmixProvider, t)

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
    setGenerating(true)

    let body: string | FormData = ''
    let headers: Record<string, string> = {
      'Api-Key': aihubmixProvider.apiKey
    }
    let url = aihubmixProvider.apiHost + `/ideogram/` + MODE_TO_CONFIG[mode]

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
            updatePaintingState({ files: validFiles, urls: [] })
          }
          return
        } else if (painting.model === 'gemini-3-pro-image-preview') {
          const geminiUrl = `${aihubmixProvider.apiHost}/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent`
          const geminiHeaders = {
            'Content-Type': 'application/json',
            'x-goog-api-key': aihubmixProvider.apiKey
          }

          const requestBody = {
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ],
                role: 'user'
              }
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio: painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
                imageSize: painting.imageSize || '1k'
              }
            }
          }

          logger.silly(`Gemini Request: ${JSON.stringify(requestBody)}`)

          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: geminiHeaders,
            body: JSON.stringify(requestBody)
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('Gemini API Error:', errorData)
            throw new Error(errorData.error?.message || t('paintings.generate_failed'))
          }

          const data = await response.json()
          logger.silly(`Gemini API Response: ${JSON.stringify(data)}`)

          // Handle array response (stream) or single object
          const responseItems = Array.isArray(data) ? data : [data]
          const base64s: string[] = []

          responseItems.forEach((item) => {
            item.candidates?.forEach((candidate: any) => {
              candidate.content?.parts?.forEach((part: any) => {
                if (part.inlineData?.data) {
                  base64s.push(part.inlineData.data)
                }
              })
            })
          })

          if (base64s.length > 0) {
            const validFiles = await Promise.all(
              base64s.map(async (base64: string) => {
                return await window.api.file.saveBase64Image(base64)
              })
            )
            await FileManager.addFiles(validFiles)
            updatePaintingState({ files: validFiles, urls: [] })
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
              throw new Error(errorData.error?.message || t('paintings.generate_failed'))
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
            setGenerating(false)
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
          } else if (painting.model === 'FLUX.1-Kontext-pro') {
            requestData = {
              prompt,
              model: painting.model,
              // width: painting.width,
              // height: painting.height,
              safety_tolerance: painting.safetyTolerance || 6
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
            throw new Error(errorData.error?.message || t('paintings.image_mix_failed'))
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
          throw new Error(errorData.error?.message || t('paintings.generate_failed'))
        }

        const data = await response.json()
        logger.silly(`通用API响应: ${data}`)
        if (data.output) {
          const base64s = data.output.b64_json.map((item) => item.bytesBase64)
          const validFiles = await Promise.all(
            base64s.map(async (base64) => {
              return await window.api.file.saveBase64Image(base64)
            })
          )
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls: [] })
          return
        }
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
    setMode(value as AihubmixPaintingMode)
    setPainting(DEFAULT_PAINTING)
  }

  // 处理随机种子的点击事件 >=0<=2147483647
  const handleRandomSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647).toString()
    updatePaintingState({ seed: randomSeed })
    return randomSeed
  }

  // 渲染配置项的函数
  const renderConfigForm = (item: ConfigItem) => (
    <PaintingConfigFieldRenderer
      item={item as any}
      painting={painting as Record<string, unknown>}
      translate={t}
      onChange={(updates) => updatePaintingState(updates as Partial<PaintingAction>)}
      onGenerateRandomSeed={() => handleRandomSeed()}
      onImageUpload={(key, file) => {
        const path = URL.createObjectURL(file)
        setFileMap({ ...fileMap, [path]: file as unknown as FileMetadata })
        updatePaintingState({ [key]: path })
      }}
      imagePreviewSrc={item.key ? (painting[item.key] as string | undefined) : undefined}
      imagePlaceholder={
        <img src={IcImageUp} className="mt-2" style={{ filter: theme === 'dark' ? 'invert(100%)' : 'none' }} />
      }
    />
  )

  // 渲染配置项的函数
  const renderConfigItem = (item: ConfigItem, index: number) => {
    return (
      <div key={index}>
        <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
          {t(item.title!)}
          {item.tooltip && <InfoTooltip content={t(item.tooltip)} />}
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
      addPainting(newPainting)
      setPainting(newPainting)
    }
  }, [filteredPaintings, mode, addPainting, getNewPainting])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

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
            <SettingHelpLink target="_blank" href={aihubmixProvider.apiHost}>
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon(aihubmixProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null
              })()}
            </SettingHelpLink>
          </div>
          <ProviderSelect
            provider={aihubmixProvider}
            options={Options}
            onChange={handleProviderChange}
            className={'mb-4'}
          />

          {/* 使用JSON配置渲染设置项 */}
          {modeConfigs[MODE_TO_CONFIG[mode]]
            .filter((item) => (item.condition ? item.condition(painting) : true))
            .map(renderConfigItem)}
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
                : painting.model?.startsWith('imagen-') || painting.model?.startsWith('FLUX')
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

export default AihubmixPage
