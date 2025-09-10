import { PlusOutlined } from '@ant-design/icons'
import AiProvider from '@renderer/aiCore'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { getProviderLabel } from '@renderer/i18n/label'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, InputNumber, Radio, Select } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useEffect, useState } from 'react'
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
  QUALITY_OPTIONS,
  TOP_UP_URL,
  ZHIPU_PAINTING_MODELS
} from './config/ZhipuConfig'
import { checkProviderEnabled } from './utils'

const ZhipuPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { zhipu_paintings, addPainting, removePainting, updatePainting } = usePaintings()
  const [painting, setPainting] = useState<any>(zhipu_paintings?.[0] || DEFAULT_PAINTING)
  const { t } = useTranslation()
  const providers = useAllProviders()

  // 确保painting使用智谱的cogview系列模型
  useEffect(() => {
    if (painting && !painting.model?.startsWith('cogview')) {
      const updatedPainting = { ...painting, model: 'cogview-3-flash' }
      setPainting(updatedPainting)
      updatePainting('zhipu_paintings', updatedPainting)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painting?.id]) // 只在painting的id改变时执行，避免无限循环

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

  const zhipuProvider = providers.find((p) => p.id === 'zhipu')!

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const navigate = useNavigate()
  const location = useLocation()

  // 自定义尺寸相关状态
  const [isCustomSize, setIsCustomSize] = useState(false)
  const [customWidth, setCustomWidth] = useState<number | undefined>()
  const [customHeight, setCustomHeight] = useState<number | undefined>()

  const updatePaintingState = (updates: Partial<any>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('zhipu_paintings', updatedPainting)
  }

  const getNewPainting = (params?: Partial<any>) => {
    return {
      ...DEFAULT_PAINTING,
      id: uuid(),
      ...params
    }
  }

  const onGenerate = async () => {
    await checkProviderEnabled(zhipuProvider, t)

    if (isLoading) return

    if (!painting.prompt.trim()) {
      window.modal.error({
        content: t('paintings.prompt_required'),
        centered: true
      })
      return
    }

    // 检查是否需要重新生成（如果已有图片）
    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })
      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    setIsLoading(true)
    dispatch(setGenerating(true))
    const controller = new AbortController()
    setAbortController(controller)

    try {
      // 使用AiProvider调用智谱AI绘图API
      const aiProvider = new AiProvider(zhipuProvider)

      // 准备API请求参数
      let actualImageSize = painting.imageSize

      // 如果是自定义尺寸，使用实际的宽高值
      if (painting.imageSize === 'custom') {
        if (!customWidth || !customHeight) {
          window.modal.error({
            content: '请设置自定义尺寸的宽度和高度',
            centered: true
          })
          return
        }
        // 验证自定义尺寸是否符合智谱AI的要求
        if (customWidth < 512 || customWidth > 2048 || customHeight < 512 || customHeight > 2048) {
          window.modal.error({
            content: '自定义尺寸必须在512px-2048px之间',
            centered: true
          })
          return
        }

        if (customWidth % 16 !== 0 || customHeight % 16 !== 0) {
          window.modal.error({
            content: '自定义尺寸必须能被16整除',
            centered: true
          })
          return
        }

        const totalPixels = customWidth * customHeight
        if (totalPixels > 2097152) {
          // 2^21 = 2097152
          window.modal.error({
            content: '自定义尺寸的总像素数不能超过2,097,152',
            centered: true
          })
          return
        }

        actualImageSize = `${customWidth}x${customHeight}`
      }

      const request = {
        model: painting.model,
        prompt: painting.prompt,
        negativePrompt: painting.negativePrompt,
        imageSize: actualImageSize,
        batchSize: painting.numImages,
        quality: painting.quality,
        signal: controller.signal
      }

      // 调用智谱AI绘图API
      const imageUrls = await aiProvider.generateImage(request)

      // 下载图片到本地文件
      if (imageUrls.length > 0) {
        const downloadedFiles = await Promise.all(
          imageUrls.map(async (url) => {
            try {
              if (!url || url.trim() === '') {
                window.toast.warning(t('message.empty_url'))
                return null
              }
              return await window.api.file.download(url)
            } catch (error) {
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

        const validFiles = downloadedFiles.filter((file): file is any => file !== null)

        await FileManager.addFiles(validFiles)

        // 处理响应结果
        const newPainting = {
          ...painting,
          urls: imageUrls,
          files: validFiles
        }

        updatePaintingState(newPainting)
      }
    } catch (error) {
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

  const onCancel = () => {
    if (abortController) {
      abortController.abort()
    }
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const onDeletePainting = async (paintingToDelete: any) => {
    if (paintingToDelete.id === painting.id) {
      if (isLoading) return

      const currentIndex = zhipu_paintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(zhipu_paintings[currentIndex - 1])
      } else if (zhipu_paintings.length > 1) {
        setPainting(zhipu_paintings[1])
      }
    }

    await removePainting('zhipu_paintings', paintingToDelete)

    if (!zhipu_paintings || zhipu_paintings.length === 1) {
      const newPainting = getNewPainting()
      const addedPainting = addPainting('zhipu_paintings', newPainting)
      setPainting(addedPainting)
    }
  }

  const onSelectPainting = (newPainting: any) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      navigate('../' + providerId, { replace: true })
    }
  }

  const onSelectModel = (modelId: string) => {
    updatePaintingState({ model: modelId })
  }

  const onSelectQuality = (quality: string) => {
    updatePaintingState({ quality })
  }

  const onSelectImageSize = (size: string) => {
    if (size === 'custom') {
      setIsCustomSize(true)
      updatePaintingState({ imageSize: 'custom' })
    } else {
      setIsCustomSize(false)
      updatePaintingState({ imageSize: size })
    }
  }

  const onCustomSizeChange = (value: number | undefined, dimension: 'width' | 'height') => {
    if (dimension === 'width') {
      setCustomWidth(value)
      updatePaintingState({ customWidth: value })
    } else {
      setCustomHeight(value)
      updatePaintingState({ customHeight: value })
    }
  }

  const createNewPainting = () => {
    if (generating) return
    const newPainting = getNewPainting()
    const addedPainting = addPainting('zhipu_paintings', newPainting)
    setPainting(addedPainting)
  }

  // 移除modelOptions的定义，直接在Select中使用

  useEffect(() => {
    if (!zhipu_paintings || zhipu_paintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('zhipu_paintings', newPainting)
    }
  }, [zhipu_paintings, addPainting])

  // 同步自定义尺寸状态
  useEffect(() => {
    if (painting.imageSize === 'custom') {
      setIsCustomSize(true)
      // 恢复自定义尺寸的宽高值
      if (painting.customWidth) {
        setCustomWidth(painting.customWidth)
      }
      if (painting.customHeight) {
        setCustomHeight(painting.customHeight)
      }
    } else {
      setIsCustomSize(false)
    }
  }, [painting.imageSize, painting.customWidth, painting.customHeight])

  return (
    <Container>
      <Navbar>
        <NavbarCenter>
          <Title>{t('title.paintings')}</Title>
        </NavbarCenter>
        {isMac && (
          <NavbarRight>
            <Button type="text" icon={<PlusOutlined />} onClick={createNewPainting} disabled={generating} />
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <ProviderTitleContainer>
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <div>
              <SettingHelpLink target="_blank" href={TOP_UP_URL}>
                {t('paintings.top_up')}
              </SettingHelpLink>
              <SettingHelpLink target="_blank" href={COURSE_URL}>
                {t('paintings.paint_course')}
              </SettingHelpLink>
              <ProviderLogo
                shape="square"
                src={getProviderLogo(zhipuProvider.id)}
                size={16}
                style={{ marginLeft: 5 }}
              />
            </div>
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

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('common.model')}</SettingTitle>
          <Select
            value={painting.model}
            onChange={onSelectModel}
            style={{ width: '100%' }}
            options={ZHIPU_PAINTING_MODELS.map((model) => ({
              label: model.name,
              value: model.id
            }))}
          />

          {painting.model === 'cogview-4-250304' && (
            <>
              <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.quality')}</SettingTitle>
              <Radio.Group value={painting.quality} onChange={(e) => onSelectQuality(e.target.value)}>
                {QUALITY_OPTIONS.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    {option.label}
                  </Radio>
                ))}
              </Radio.Group>
            </>
          )}

          <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>{t('paintings.image.size')}</SettingTitle>
          <Select
            value={isCustomSize ? 'custom' : painting.imageSize}
            onChange={onSelectImageSize}
            style={{ width: '100%' }}>
            {IMAGE_SIZES.map((size) => (
              <Select.Option key={size.value} value={size.value}>
                {size.label}
              </Select.Option>
            ))}
            <Select.Option value="custom" key="custom">
              {t('paintings.custom_size')}
            </Select.Option>
          </Select>

          {/* 自定义尺寸输入框 */}
          {isCustomSize && (
            <div style={{ marginTop: 10 }}>
              <HStack style={{ gap: 8, alignItems: 'center' }}>
                <InputNumber
                  placeholder="W"
                  value={customWidth}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'width')}
                  min={512}
                  max={2048}
                  style={{ width: 80, flex: 1 }}
                />
                <span style={{ color: 'var(--color-text-2)', fontSize: '12px' }}>x</span>
                <InputNumber
                  placeholder="H"
                  value={customHeight}
                  controls={false}
                  onChange={(value) => onCustomSizeChange(value || undefined, 'height')}
                  min={512}
                  max={2048}
                  style={{ width: 80, flex: 1 }}
                />
                <span style={{ color: 'var(--color-text-2)', fontSize: '12px' }}>px</span>
              </HStack>
              <div style={{ marginTop: 5, fontSize: '12px', color: 'var(--color-text-3)' }}>
                长宽均需满足512px-2048px之间, 需被16整除, 并保证最大像素数不超过2^21px
              </div>
            </div>
          )}
        </LeftContainer>
        <MainContainer>
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
          namespace="zhipu_paintings"
          paintings={zhipu_paintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={createNewPainting}
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

const Textarea = styled(TextArea)`
  padding: 10px;
  border-radius: 0;
  display: flex;
  flex: 1;
  resize: none !important;
  overflow: auto;
  width: auto;
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
  gap: 8px;
`

const Title = styled.h1`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
`

const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
`

const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ProviderLogo = styled(Avatar)`
  border-radius: 4px;
`

export default ZhipuPage
