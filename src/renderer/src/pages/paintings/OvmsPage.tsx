import { PlusOutlined, RedoOutlined } from '@ant-design/icons'
import { Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getProviderLabel } from '@renderer/i18n/label'
import FileManager from '@renderer/services/FileManager'
import type { OvmsPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Input, InputNumber, Select, Slider } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import {
  type ConfigItem,
  createDefaultOvmsPainting,
  createOvmsConfig,
  DEFAULT_OVMS_PAINTING,
  getOvmsModels,
  OVMS_MODELS
} from './config/ovmsConfig'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { saveGeneratedPaintingFiles } from './utils/imageFiles'

const logger = loggerService.withContext('OvmsPage')

const OvmsPage: FC<{ Options: string[] }> = ({ Options }) => {
  const { addPainting, removePainting, updatePainting, ovms_paintings } = usePaintings()
  const ovmsPaintings = useMemo(() => ovms_paintings || [], [ovms_paintings])
  const [painting, setPainting] = useState<OvmsPainting>(ovmsPaintings[0] || DEFAULT_OVMS_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
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
          const validFiles = await saveGeneratedPaintingFiles({ base64s })
          updatePaintingState({ files: validFiles, urls: [] })
        }

        // Handle URL-based images if available
        const urls = data.data.filter((item) => item.url).map((item) => item.url)

        if (urls.length > 0) {
          const validFiles = await saveGeneratedPaintingFiles({
            urls,
            t,
            emptyUrlLogMessage: 'Image URL is empty, possibly due to prohibited prompt',
            errorLogMessage: 'Failed to download image'
          })
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
      const validFiles = await saveGeneratedPaintingFiles({
        urls: painting.urls,
        t,
        emptyUrlLogMessage: 'Image URL is empty, possibly due to prohibited prompt',
        errorLogMessage: 'Failed to download image'
      })
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

    void removePainting('ovms_paintings', paintingToDelete)
  }

  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    enabled: autoTranslateWithSpace,
    onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
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
          <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
            <Slider
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
            <InputNumber
              className="w-17.5!"
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
          </div>
        )
      }
      case 'input':
        return (
          <Input
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            suffix={
              item.key === 'rng_seed' ? (
                <RedoOutlined
                  onClick={handleRandomSeed}
                  style={{ cursor: 'pointer', color: 'var(--color-foreground-secondary)' }}
                />
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
              <Info className="ml-1.25 h-4 w-3.5 cursor-help text-foreground-secondary opacity-60 hover:opacity-100" />
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
      <div id="content-container" className="flex h-full flex-1 flex-row overflow-hidden bg-background">
        <div className="flex h-full max-w-(--assistants-width) flex-1 flex-col overflow-hidden bg-background [border-right:0.5px_solid_var(--color-border)]">
          <Scrollbar>
            <div className="p-5">
              <div className="mb-1.25 flex items-center justify-between">
                <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
                <SettingHelpLink
                  target="_blank"
                  href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
                  {t('paintings.learn_more')}
                  {(() => {
                    const Icon = resolveProviderIcon(ovmsProvider.id)
                    return Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null
                  })()}
                </SettingHelpLink>
              </div>

              <Select
                value={providerOptions.find((p) => p.value === 'ovms')?.value || 'ovms'}
                onChange={handleProviderChange}
                style={{ width: '100%', marginBottom: 15 }}>
                {providerOptions.map((provider) => (
                  <Select.Option value={provider.value} key={provider.value}>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const Icon = resolveProviderIcon(provider.value || '')
                        return Icon ? <Icon.Avatar size={16} /> : null
                      })()}
                      {provider.label}
                    </div>
                  </Select.Option>
                ))}
              </Select>

              {/* Render configuration items using JSON config */}
              {ovmsConfig.map(renderConfigItem)}
            </div>
          </Scrollbar>
        </div>
        <div className="flex h-full flex-1 flex-col bg-background">
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
            textareaRef={textareaRef}
            value={painting.prompt}
            disabled={isLoading}
            placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
            onChange={(prompt) => updatePaintingState({ prompt })}
            onKeyDown={handleKeyDown}
            onGenerate={onGenerate}
            generateDisabled={isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value}
            actionsClassName="flex flex-row items-center gap-1.5"
          />
        </div>
        <PaintingsList
          namespace="ovms_paintings"
          paintings={ovmsPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      </div>
    </div>
  )
}

export default OvmsPage
