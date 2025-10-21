import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { getProviderLogo } from '@renderer/config/providers'
import { LanguagesEnum } from '@renderer/config/translate'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getProviderLabel } from '@renderer/i18n/label'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, OvmsPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Avatar, Input, InputNumber, Select, Slider } from 'antd'
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
import {
  type ConfigItem,
  createDefaultOvmsPainting,
  createOvmsConfig,
  DEFAULT_OVMS_PAINTING,
  getOvmsModels,
  OVMS_MODELS
} from './config/ovmsConfig'

const logger = loggerService.withContext('OvmsPage')

const OvmsPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { addPainting, removePainting, updatePainting, ovms_paintings } = usePaintings()
  const ovmsPaintings = useMemo(() => ovms_paintings || [], [ovms_paintings])
  const [painting, setPainting] = useState<OvmsPainting>(ovmsPaintings[0] || DEFAULT_OVMS_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const [isTranslating, setIsTranslating] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ label: string; value: string }>>([])
  const [ovmsConfig, setOvmsConfig] = useState<ConfigItem[]>([])

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
  const [generating, setGenerating] = useCache('chat.generating')

  const navigate = useNavigate()
  const location = useLocation()
  const { autoTranslateWithSpace } = useSettings()
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const ovmsProvider = providers.find((p) => p.id === 'ovms')!

  const getNewPainting = useCallback(() => {
    if (availableModels.length > 0) {
      return createDefaultOvmsPainting(availableModels)
    }
    return {
      ...DEFAULT_OVMS_PAINTING,
      id: uuid()
    }
  }, [availableModels])

  const textareaRef = useRef<any>(null)

  // Load available models on component mount
  useEffect(() => {
    const loadModels = () => {
      try {
        // Get OVMS provider to access its models
        const ovmsProvider = providers.find((p) => p.id === 'ovms')
        const providerModels = ovmsProvider?.models || []

        // Filter and format models for image generation
        const filteredModels = getOvmsModels(providerModels)
        setAvailableModels(filteredModels)
        setOvmsConfig(createOvmsConfig(filteredModels))

        // Update painting if it doesn't have a valid model
        if (filteredModels.length > 0 && !filteredModels.some((m) => m.value === painting.model)) {
          const defaultPainting = createDefaultOvmsPainting(filteredModels)
          setPainting(defaultPainting)
        }
      } catch (error) {
        logger.error(`Failed to load OVMS models: ${error}`)
        // Use default config if loading fails
        setOvmsConfig(createOvmsConfig())
      }
    }

    loadModels()
  }, [providers, painting.model]) // Re-run when providers change

  const updatePaintingState = (updates: Partial<OvmsPainting>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting('ovms_paintings', updatedPainting)
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
            logger.error('Image URL is empty, possibly due to prohibited prompt')
            window.toast.warning(t('message.empty_url'))
            return null
          }
          return await window.api.file.download(url)
        } catch (error) {
          logger.error(`Failed to download image: ${error}`)
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

    if (!painting.model || !painting.prompt) {
      return
    }

    const controller = new AbortController()
    setAbortController(controller)
    setIsLoading(true)
    setGenerating(true)

    try {
      // Prepare request body for OVMS
      const requestBody = {
        model: painting.model,
        prompt: painting.prompt,
        size: painting.size || '512x512',
        num_inference_steps: painting.num_inference_steps || 4,
        rng_seed: painting.rng_seed || 0
      }

      logger.info('OVMS API request:', requestBody)

      const response = await fetch(`${ovmsProvider.apiHost}images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }))
        logger.error('OVMS API error:', errorData)
        throw new Error(errorData.error?.message || 'Image generation failed')
      }

      const data = await response.json()
      logger.info('OVMS API response:', data)

      // Handle base64 encoded images
      if (data.data && data.data.length > 0) {
        const base64s = data.data.filter((item) => item.b64_json).map((item) => item.b64_json)

        if (base64s.length > 0) {
          const validFiles = await Promise.all(
            base64s.map(async (base64) => {
              return await window.api.file.saveBase64Image(base64)
            })
          )
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls: validFiles.map((file) => file.name) })
        }

        // Handle URL-based images if available
        const urls = data.data.filter((item) => item.url).map((item) => item.url)

        if (urls.length > 0) {
          const validFiles = await downloadImages(urls)
          await FileManager.addFiles(validFiles)
          updatePaintingState({ files: validFiles, urls })
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

  const handleRetry = async (painting: OvmsPainting) => {
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
    const newPainting = addPainting('ovms_paintings', getNewPainting())
    updatePainting('ovms_paintings', newPainting)
    setPainting(newPainting)
    return newPainting
  }

  const onDeletePainting = (paintingToDelete: OvmsPainting) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = ovmsPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(ovmsPaintings[currentIndex - 1])
      } else if (ovmsPaintings.length > 1) {
        setPainting(ovmsPaintings[1])
      }
    }

    removePainting('ovms_paintings', paintingToDelete)
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

  // Handle random seed generation
  const handleRandomSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647)
    updatePaintingState({ rng_seed: randomSeed })
    return randomSeed
  }

  // Render configuration form
  const renderConfigForm = (item: ConfigItem) => {
    switch (item.type) {
      case 'select': {
        const isDisabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled
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
              item.key === 'rng_seed' ? (
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
          <RowFlex>
            <Switch
              checked={(painting[item.key!] || item.initialValue) as boolean}
              onChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </RowFlex>
        )
      default:
        return null
    }
  }

  // Render configuration item
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

  const onSelectPainting = (newPainting: OvmsPainting) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  useEffect(() => {
    if (ovmsPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('ovms_paintings', newPainting)
      setPainting(newPainting)
    }
  }, [ovmsPaintings, addPainting, getNewPainting])

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
            <Button size="sm" className="nodrag" startContent={<PlusOutlined />} onPress={handleAddPainting}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <ContentContainer id="content-container">
        <LeftContainer>
          <Scrollbar>
            <div style={{ padding: '20px' }}>
              <ProviderTitleContainer>
                <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
                <SettingHelpLink
                  target="_blank"
                  href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
                  {t('paintings.learn_more')}
                  <ProviderLogo
                    shape="square"
                    src={getProviderLogo(ovmsProvider.id)}
                    size={16}
                    style={{ marginLeft: 5 }}
                  />
                </SettingHelpLink>
              </ProviderTitleContainer>

              <Select
                value={providerOptions.find((p) => p.value === 'ovms')?.value || 'ovms'}
                onChange={handleProviderChange}
                style={{ width: '100%', marginBottom: 15 }}>
                {providerOptions.map((provider) => (
                  <Select.Option value={provider.value} key={provider.value}>
                    <SelectOptionContainer>
                      <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
                      {provider.label}
                    </SelectOptionContainer>
                  </Select.Option>
                ))}
              </Select>

              {/* Render configuration items using JSON config */}
              {ovmsConfig.map(renderConfigItem)}
            </div>
          </Scrollbar>
        </LeftContainer>
        <MainContainer>
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
              placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
              onKeyDown={handleKeyDown}
            />
            <Toolbar>
              <ToolbarMenu>
                <SendMessageButton
                  sendMessage={onGenerate}
                  disabled={isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value}
                />
              </ToolbarMenu>
            </Toolbar>
          </InputContainer>
        </MainContainer>
        <PaintingsList
          namespace="ovms_paintings"
          paintings={ovmsPaintings}
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

const LeftContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background);
  max-width: var(--assistants-width);
  border-right: 0.5px solid var(--color-border);
  overflow: hidden;
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

const ProviderTitleContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
`

const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default OvmsPage
