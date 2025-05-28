import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import DMXAPIToImg from '@renderer/assets/images/providers/DMXAPI-to-img.webp'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { FileType, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { DmxapiPainting, PaintingAction } from '@types'
import { Avatar, Button, Input, Radio, Select, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import React, { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingsList from './components/PaintingsList'
import {
  COURSE_URL,
  DEFAULT_PAINTING,
  IMAGE_SIZES,
  STYLE_TYPE_OPTIONS,
  TEXT_TO_IMAGES_MODELS
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
    return {
      label: t(`provider.${provider?.id}`),
      value: provider?.id
    }
  })

  const dmxapiProvider = providers.find((p) => p.id === 'dmxapi')!

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()

  const getNewPainting = () => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      seed: generateRandomSeed()
    }
  }

  const modelOptions = TEXT_TO_IMAGES_MODELS.map((model) => ({
    label: model.name,
    value: model.id
  }))

  const textareaRef = useRef<any>(null)

  const updatePaintingState = (updates: Partial<DmxapiPainting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('DMXAPIPaintings', updatedPainting)
  }

  const onSelectModel = (modelId: string) => {
    const model = TEXT_TO_IMAGES_MODELS.find((m) => m.id === modelId)
    if (model) {
      updatePaintingState({ model: modelId })
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
  }

  // 准备V1生成请求函数
  const prepareV1GenerateRequest = (prompt: string, painting: DmxapiPainting) => {
    const params = {
      prompt,
      model: painting.model,
      n: painting.n
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
      endpoint: `${dmxapiProvider.apiHost}/v1/images/generations`
    }
  }

  // API请求函数
  const callApi = async (requestConfig: { endpoint: string; body: any }, controller: AbortController) => {
    const { endpoint, body } = requestConfig
    const headers = {}

    // 如果是JSON数据，添加Content-Type头
    if (typeof body === 'string') {
      headers['Content-Type'] = 'application/json'
      headers['Authorization'] = `Bearer ${dmxapiProvider.apiKey}`
      headers['User-Agent'] = 'DMXAPI/1.0.0 (https://www.dmxapi.com)'
      headers['Accept'] = 'application/json'
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || '操作失败')
    }

    const data = await response.json()
    return data.data.map((item: { url: string }) => item.url)
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
  const prepareRequestConfig = (prompt: string, painting: PaintingAction) => {
    // 根据模式和模型版本返回不同的请求配置
    return prepareV1GenerateRequest(prompt, painting)
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
      if (painting.files.length > 0) {
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
        const validFiles = downloadedFiles.filter((file): file is FileType => file !== null)

        // 删除之前的图片
        await FileManager.deleteFiles(painting.files)
        // 保存文件并更新状态
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls })
      }
    } catch (error) {
      // 错误处理
      if (error instanceof Error && error.name !== 'AbortError') {
        window.modal.error({
          content:
            error.message.startsWith('paintings.') || error.message.startsWith('error.')
              ? t(error.message)
              : getErrorMessage(error),
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

  const onDeletePainting = (paintingToDelete: DmxapiPainting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = DMXAPIPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(DMXAPIPaintings[currentIndex - 1])
      } else if (DMXAPIPaintings.length > 1) {
        setPainting(DMXAPIPaintings[1])
      }
    }

    removePainting(mode, paintingToDelete).then(() => {})
  }

  const onSelectPainting = (newPainting: DmxapiPainting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const spaceClickTimer = useRef<NodeJS.Timeout>(null)

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      navigate('../' + providerId, { replace: true })
    }
  }

  useEffect(() => {
    if (!DMXAPIPaintings || DMXAPIPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('DMXAPIPaintings', newPainting)
      setPainting(newPainting)
    }

    return () => {
      if (spaceClickTimer.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [DMXAPIPaintings, DMXAPIPaintings.length, addPainting, mode])

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
          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('common.model')}</SettingTitle>
          <Select value={painting.model} options={modelOptions} onChange={onSelectModel} />
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
        </LeftContainer>
        <MainContainer>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
            imageCover={
              painting?.urls?.length > 0 || DMXAPIPaintings?.length > 1 ? null : (
                <EmptyImgBox>
                  <EmptyImg></EmptyImg>
                </EmptyImgBox>
              )
            }
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

const EmptyImgBox = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  align-items: center;
`

const EmptyImg = styled.div`
  width: 70vh;
  height: 70vh;
  background-size: 100% 100%;
  background-image: url(${DMXAPIToImg});
`

export default DmxapiPage
