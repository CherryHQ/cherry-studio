import { PlusOutlined } from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { usePaintingList } from '@data/hooks/usePaintings'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { LanguagesEnum } from '@renderer/config/translate'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { translateText } from '@renderer/services/TranslateService'
import type { FileMetadata, OvmsPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { PaintingConfigFieldRenderer } from './components/PaintingConfigFieldRenderer'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
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
  const {
    items: ovmsPaintings,
    add: addPaintingScoped,
    remove: removePaintingScoped,
    update: updatePaintingScoped,
    reorder
  } = usePaintingList({ providerId: 'ovms', mode: 'generate' })
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
    updatePaintingScoped(updatedPainting)
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

    const prompt = painting.prompt || ''
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
          updatePaintingState({ files: validFiles, urls: [] })
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
    const newPainting = addPaintingScoped(getNewPainting())
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

    void removePaintingScoped(paintingToDelete)
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

  // Handle random seed generation
  const handleRandomSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647)
    updatePaintingState({ rng_seed: randomSeed })
    return randomSeed
  }

  // Render configuration form
  const renderConfigForm = (item: ConfigItem) => (
    <PaintingConfigFieldRenderer
      item={item as any}
      painting={painting as unknown as Record<string, unknown>}
      translate={t}
      onChange={(updates) => updatePaintingState(updates as Partial<OvmsPainting>)}
      onGenerateRandomSeed={() => handleRandomSeed()}
    />
  )

  // Render configuration item
  const renderConfigItem = (item: ConfigItem, index: number) => {
    return (
      <div key={index}>
        <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
          {t(item.title!)}
          {item.tooltip && (
            <Tooltip title={t(item.tooltip)}>
              <Info className="ml-[5px] h-4 w-[14px] cursor-help text-[var(--color-text-2)] opacity-60 hover:opacity-100" />
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
      addPaintingScoped(newPainting)
      setPainting(newPainting)
    }
  }, [ovmsPaintings, addPaintingScoped, getNewPainting])

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
        <div className="flex h-full max-w-[var(--assistants-width)] flex-1 flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] overflow-hidden">
          <Scrollbar className="h-full">
            <div style={{ padding: '20px' }}>
              <div className="mb-[5px] flex items-center justify-between">
                <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
                <SettingHelpLink
                  target="_blank"
                  href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
                  {t('paintings.learn_more')}
                  {(() => {
                    const Icon = resolveProviderIcon(ovmsProvider.id)
                    return Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null
                  })()}
                </SettingHelpLink>
              </div>

              <ProviderSelect
                provider={ovmsProvider}
                options={Options}
                onChange={handleProviderChange}
                className="mb-4"
              />

              {/* Render configuration items using JSON config */}
              {ovmsConfig.map(renderConfigItem)}
            </div>
          </Scrollbar>
        </div>
        <div className="flex h-full flex-1 flex-col bg-[var(--color-background)]">
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
            disabled={isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value}
            placeholder={isTranslating ? t('paintings.translating') : t('paintings.prompt_placeholder')}
            onPromptChange={(value) => updatePaintingState({ prompt: value })}
            onGenerate={onGenerate}
            onKeyDown={handleKeyDown}
          />
        </div>
        <PaintingsList
          paintings={ovmsPaintings}
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

export default OvmsPage
