import { PlusOutlined } from '@ant-design/icons'
import AiProvider from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
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
import PaintingsList from '@renderer/pages/paintings/components/PaintingsList'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from '@renderer/pages/paintings/config/NewApiConfig'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { FileMetadata } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Button, Empty, InputNumber, Segmented, Select, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import React, { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'

const NewApiPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<keyof PaintingsState>('openai_image_generate')
  const { addPainting, removePainting, updatePainting, newApiPaintings } = usePaintings()
  const filteredPaintings = useMemo(() => newApiPaintings[mode] || [], [newApiPaintings, mode])
  const [painting, setPainting] = useState<PaintingAction>(filteredPaintings[0] || DEFAULT_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [editImageFiles, setEditImageFiles] = useState<File[]>([])

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
  const newApiProvider = providers.find((p) => p.id === 'new-api')!

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'openai_image_generate' },
    { label: t('paintings.mode.edit'), value: 'openai_image_edit' }
  ]

  const textareaRef = useRef<any>(null)

  // 获取编辑模式的图片文件
  const editImages = useMemo(() => {
    return editImageFiles
  }, [editImageFiles])

  const updatePaintingState = (updates: Partial<PaintingAction>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting(mode, updatedPainting)
  }

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
      id: uuid()
    }
  }, [modelOptions, painting.model])

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
            console.error('图像URL为空')
            window.message.warning({
              content: t('message.empty_url'),
              key: 'empty-url-warning'
            })
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          console.error('下载图像失败:', error)
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

    if (!newApiProvider.enabled) {
      window.modal.error({
        content: t('error.provider_disabled'),
        centered: true
      })
      return
    }

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
    dispatch(setGenerating(true))

    let body: string | FormData = ''
    const headers: Record<string, string> = {
      Authorization: `Bearer ${AI.getApiKey()}`
    }
    const url = newApiProvider.apiHost + `/v1/images/generations`
    const editUrl = newApiProvider.apiHost + `/v1/images/edits`

    try {
      if (mode === 'openai_image_generate') {
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
      } else if (mode === 'openai_image_edit') {
        // -------- Edit Mode --------
        if (editImages.length === 0) {
          window.message.warning({ content: t('paintings.image_file_required') })
          return
        }

        const formData = new FormData()
        formData.append('prompt', prompt)
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

      const requestUrl = mode === 'openai_image_edit' ? editUrl : url
      const response = await fetch(requestUrl, { method: 'POST', headers, body })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || '生成图像失败')
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
        updatePaintingState({ files: validFiles, urls: validFiles.map((file) => file.name) })
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
    if (newApiPaintings[value as keyof PaintingsState] && newApiPaintings[value as keyof PaintingsState].length > 0) {
      setPainting(newApiPaintings[value as keyof PaintingsState][0])
    } else {
      setPainting(DEFAULT_PAINTING)
    }
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
    navigate(`/settings/provider?id=${newApiProvider.id}`)
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
            <SettingHelpLink target="_blank" href={'https://docs.newapi.pro/apps/cherry-studio/'}>
              {t('paintings.learn_more')}
              <ProviderLogo
                shape="square"
                src={getProviderLogo(newApiProvider.id)}
                size={16}
                style={{ marginLeft: 5 }}
              />
            </SettingHelpLink>
          </ProviderTitleContainer>

          <Select
            value={providerOptions.find((p) => p.value === 'new-api')?.value}
            onChange={handleProviderChange}
            style={{ width: '100%' }}>
            {providerOptions.map((provider) => (
              <Select.Option value={provider.value} key={provider.value}>
                <SelectOptionContainer>
                  <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
                  {provider.label}
                </SelectOptionContainer>
              </Select.Option>
            ))}
          </Select>

          {/* 当没有可用的 Image Generation 模型时，提示用户先去新增 */}
          {modelOptions.length === 0 && (
            <Empty
              style={{ marginTop: 24 }}
              description={t('paintings.no_image_generation_model', {
                endpoint_type: t('endpoint_type.image-generation')
              })}>
              <Button type="primary" onClick={handleShowAddModelPopup}>
                {t('paintings.go_to_settings')}
              </Button>
            </Empty>
          )}

          {modelOptions.length > 0 && (
            <>
              {mode === 'openai_image_edit' && (
                <>
                  <SettingTitle style={{ marginTop: 20 }}>{t('paintings.input_image')}</SettingTitle>
                  <ImageUploadButton
                    accept="image/png, image/jpeg, image/gif"
                    maxCount={16}
                    showUploadList={true}
                    listType="picture"
                    beforeUpload={handleImageUpload}>
                    <ImagePlaceholder>
                      <ImageSizeImage src={IcImageUp} theme={theme} />
                    </ImagePlaceholder>
                  </ImageUploadButton>
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
                        {t(`paintings.image_size_options.${s.value}`, { defaultValue: s.value })}
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
                        {t(`paintings.quality_options.${q.value}`, { defaultValue: q.value })}
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
                          {t(`paintings.moderation_options.${m.value}`, { defaultValue: m.value })}
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
                          {t(`paintings.background_options.${b.value}`, { defaultValue: b.value })}
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

const ImageUploadButton = styled(Upload)`
  & .ant-upload.ant-upload-select {
    width: 100% !important;
    height: 60px !important;
    border: 1px dashed var(--color-border);
  }
`

const ImagePlaceholder = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
  cursor: pointer;
  gap: 8px;
`

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  width: 20px;
  height: 20px;
`

export default NewApiPage
