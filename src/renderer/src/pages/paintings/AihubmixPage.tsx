import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileType } from '@renderer/types'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, Input, InputNumber, Radio, Segmented, Select, Slider, Switch, Tooltip, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './Artboard'
import { type ConfigItem, createModeConfigs } from './config/aihubmixConfig'
import { DEFAULT_PAINTING } from './config/constants'
import PaintingsList from './PaintingsList'

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
  const [fileMap, setFileMap] = useState<{ [key: string]: FileType }>({})

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
    // { label: t('paintings.mode.edit'), value: 'edit' },
    { label: t('paintings.mode.remix'), value: 'remix' },
    { label: t('paintings.mode.upscale'), value: 'upscale' }
  ]

  const getNewPainting = () => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid()
    }
  }

  const textareaRef = useRef<any>(null)

  const updatePaintingState = (updates: Partial<PaintingAction>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting(mode, updatedPainting)
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
    const headers: Record<string, string> = {
      'Api-Key': aihubmixProvider.apiKey
    }

    // 不使用 AiProvider 的通用规则，而是直接调用自定义接口
    try {
      if (mode === 'generate') {
        const requestData = {
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
        body = JSON.stringify(requestData)
        headers['Content-Type'] = 'application/json'
      } else {
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
        let imageRequest: Record<string, any> = {
          prompt,
          num_images: painting.numImages,
          seed: painting.seed ? +painting.seed : undefined,
          magic_prompt_option: painting.magicPromptOption ? 'ON' : 'OFF'
        }
        if (mode === 'remix') {
          imageRequest = {
            ...imageRequest,
            model: painting.model,
            aspect_ratio: painting.aspectRatio,
            image_weight: painting.imageWeight,
            style_type: painting.styleType
          }
        } else if (mode === 'upscale') {
          imageRequest = {
            ...imageRequest,
            resemblance: painting.resemblance,
            detail: painting.detail
          }
        } else if (mode === 'edit') {
          imageRequest = {
            ...imageRequest,
            model: painting.model,
            style_type: painting.styleType
          }
        }
        form.append('image_request', JSON.stringify(imageRequest))
        form.append('image_file', fileMap[painting.imageFile] as unknown as Blob)
        body = form
      }

      // 直接调用自定义接口
      const response = await fetch(aihubmixProvider.apiHost + `/ideogram/` + mode, { method: 'POST', headers, body })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || '生成图像失败')
      }

      const data = await response.json()
      const urls = data.data.map((item: any) => item.url)

      if (urls.length > 0) {
        const downloadedFiles = await Promise.all(
          urls.map(async (url) => {
            try {
              return await window.api.file.download(url)
            } catch (error) {
              console.error('下载图像失败:', error)
              return null
            }
          })
        )

        const validFiles = downloadedFiles.filter((file): file is FileType => file !== null)

        await FileManager.addFiles(validFiles)

        updatePaintingState({ files: validFiles, urls })
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content: getErrorMessage(error),
          centered: true
        })
      }
    } finally {
      setIsLoading(false)
      dispatch(setGenerating(false))
      setAbortController(null)
    }
  }

  const handleRetry = async (painting: PaintingAction) => {
    setIsLoading(true)
    const downloadedFiles = await Promise.all(
      painting.urls.map(async (url) => {
        try {
          return await window.api.file.download(url)
        } catch (error) {
          console.error('下载图像失败:', error)
          setIsLoading(false)
          return null
        }
      })
    )

    const validFiles = downloadedFiles.filter((file): file is FileType => file !== null)

    await FileManager.addFiles(validFiles)

    updatePaintingState({ files: validFiles, urls: painting.urls })
    setIsLoading(false)
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
      const translatedText = await translateText(painting.prompt, 'english')
      updatePaintingState({ prompt: translatedText })
    } catch (error) {
      console.error('Translation failed:', error)
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
  const renderConfigItem = (item: ConfigItem, index: number) => {
    switch (item.type) {
      case 'title':
        return (
          <SettingTitle key={index} style={{ marginBottom: 5, marginTop: 15 }}>
            {t(item.title!)}
            {item.tooltip && (
              <Tooltip title={t(item.tooltip)}>
                <InfoIcon />
              </Tooltip>
            )}
          </SettingTitle>
        )
      case 'select':
        return (
          <Select
            key={index}
            disabled={item.disabled}
            value={painting[item.key!] || item.initialValue}
            options={item.options}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      case 'radio':
        return (
          <Radio.Group
            key={index}
            value={painting[item.key!]}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}>
            {item.options!.map((option) => (
              <Radio.Button key={option.value} value={option.value}>
                {option.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        )
      case 'slider':
        return (
          <SliderContainer key={index}>
            <Slider
              min={item.min}
              max={item.max}
              step={item.step}
              value={painting[item.key!] as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
            <StyledInputNumber
              min={item.min}
              max={item.max}
              step={item.step}
              value={painting[item.key!] as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
          </SliderContainer>
        )
      case 'input':
        // 处理随机种子按钮的特殊情况
        if (item.key === 'seed') {
          return (
            <Input
              key={index}
              value={painting[item.key] as string}
              onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
              suffix={
                <RedoOutlined onClick={handleRandomSeed} style={{ cursor: 'pointer', color: 'var(--color-text-2)' }} />
              }
            />
          )
        }
        return (
          <Input
            key={index}
            value={painting[item.key!] as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            suffix={item.suffix}
          />
        )
      case 'inputNumber':
        return (
          <InputNumber
            key={index}
            min={item.min}
            max={item.max}
            style={{ width: '100%' }}
            value={painting[item.key!] as number}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      case 'textarea':
        return (
          <TextArea
            key={index}
            value={painting[item.key!] as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            spellCheck={false}
            rows={4}
          />
        )
      case 'switch':
        return (
          <HStack key={index}>
            <Switch
              checked={painting[item.key!] as boolean}
              onChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </HStack>
        )
      case 'image':
        return (
          <ImageUploadButton
            key={index}
            accept="image/png, image/jpeg, image/gif"
            maxCount={1}
            showUploadList={false}
            listType="picture-card"
            onChange={async ({ file }) => {
              const path = file.originFileObj?.path || ''
              setFileMap({ ...fileMap, [path]: file.originFileObj as unknown as FileType })
              updatePaintingState({ [item.key!]: path })
            }}>
            {painting[item.key!] ? (
              <ImagePreview>
                <img src={'file://' + painting[item.key!]} alt="预览图" />
              </ImagePreview>
            ) : (
              <ImageSizeImage src={IcImageUp} theme={theme} />
            )}
          </ImageUploadButton>
        )
      default:
        return null
    }
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
  }, [filteredPaintings, mode, addPainting, painting])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
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
          {modeConfigs[mode].map(renderConfigItem)}
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
              placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder_edit')}
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
  font-family: Ubuntu;
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
