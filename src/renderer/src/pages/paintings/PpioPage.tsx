import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { LanguagesEnum } from '@renderer/config/translate'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileMetadata, PaintingsState, PpioPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import type { UploadFile } from 'antd'
import { Button, Input, Segmented, Select, Switch, Tooltip, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingTitle } from '../settings'
import Artboard from './components/Artboard'
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

  const providers = useAllProviders()
  const ppioProvider = providers.find((p) => p.id === 'ppio')

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)

  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const textareaRef = useRef<any>(null)

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
    setCurrentImageIndex(0)
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
    dispatch(setGenerating(false))
  }

  const handleProviderChange = (providerId: string) => {
    navigate(`/paintings/${providerId}`, { replace: true })
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

    setIsLoading(true)
    dispatch(setGenerating(true))

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
      dispatch(setGenerating(false))
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
      onGenerate()
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
        handleTranslate()
        setSpaceClickCount(0)
      }
    }
  }

  // 处理图片上传
  const handleImageUpload = async (file: UploadFile, fieldKey: keyof PpioPainting = 'imageFile') => {
    if (file.originFileObj) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        updatePaintingState({ [fieldKey]: base64 })
      }
      reader.readAsDataURL(file.originFileObj)
    }
    return false
  }

  // 渲染配置项表单
  const renderConfigForm = (item: PpioConfigItem) => {
    switch (item.type) {
      case 'select':
        return (
          <Select
            value={painting[item.key!] || item.initialValue}
            options={item.options}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
            style={{ width: '100%' }}
          />
        )
      case 'input':
        if (item.key === 'ppioSeed') {
          return (
            <Input
              value={painting.ppioSeed === -1 ? '' : painting.ppioSeed}
              placeholder={t('paintings.seed_random')}
              onChange={(e) => {
                const value = e.target.value
                updatePaintingState({ ppioSeed: value ? parseInt(value, 10) : -1 })
              }}
              suffix={
                <RedoOutlined
                  onClick={() => updatePaintingState({ ppioSeed: Math.floor(Math.random() * 2147483647) })}
                  style={{ cursor: 'pointer', color: 'var(--color-text-2)' }}
                />
              }
            />
          )
        }
        return (
          <Input
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
          />
        )
      case 'switch':
        return (
          <HStack>
            <Switch
              checked={(painting[item.key!] ?? item.initialValue) as boolean}
              onChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </HStack>
        )
      case 'image': {
        const imageKey = item.key as keyof PpioPainting
        const imageValue = painting[imageKey] as string | undefined
        return (
          <ImageUploadButton
            accept="image/png, image/jpeg, image/gif, image/webp"
            maxCount={1}
            showUploadList={false}
            listType="picture-card"
            beforeUpload={(file) => handleImageUpload({ originFileObj: file } as UploadFile, imageKey)}>
            {imageValue ? (
              <ImagePreview>
                <img src={imageValue} alt={t('common.image_preview')} />
              </ImagePreview>
            ) : (
              <ImageSizeImage src={IcImageUp} theme={theme} />
            )}
          </ImageUploadButton>
        )
      }
      case 'textarea':
        return (
          <TextArea
            value={(painting[item.key!] || '') as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            placeholder={item.required ? t('paintings.prompt_placeholder') : ''}
            rows={3}
            style={{ resize: 'none' }}
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

  // 初始化
  useEffect(() => {
    if (filteredPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting(mode, newPainting)
      setPainting(newPainting)
    }

    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [filteredPaintings.length, addPainting, getNewPainting, mode])

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
              onClick={() => setPainting(addPainting(mode, getNewPainting()))}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
          {ppioProvider && <ProviderSelect provider={ppioProvider} options={Options} onChange={handleProviderChange} />}

          <SettingTitle className="mt-4 mb-1">{t('common.model')}</SettingTitle>
          <Select value={painting.model} options={modelOptions} onChange={onSelectModel} style={{ width: '100%' }} />

          {/* 渲染其他配置项 */}
          {modeConfigs[mode].map(renderConfigItem)}
        </LeftContainer>
        <MainContainer>
          {/* 模式切换 */}
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
          />
          <InputContainer>
            <Textarea
              ref={textareaRef}
              variant="borderless"
              disabled={isLoading}
              value={painting.prompt}
              spellCheck={false}
              onChange={(e) => updatePaintingState({ prompt: e.target.value })}
              placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
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
          namespace={mode as keyof PaintingsState}
          paintings={filteredPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={() => setPainting(addPainting(mode, getNewPainting()))}
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
  width: 16px;
  height: 16px;

  &:hover {
    opacity: 1;
  }
`

const ModeSegmentedContainer = styled.div`
  display: flex;
  justify-content: center;
  padding-top: 24px;
`

const ImageUploadButton = styled(Upload)`
  .ant-upload.ant-upload-select {
    width: 100% !important;
    height: 120px !important;
    margin: 0 !important;
    border-radius: 8px;
  }
`

const ImagePreview = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
`

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  width: 40px;
  height: 40px;
`

export default PpioPage
