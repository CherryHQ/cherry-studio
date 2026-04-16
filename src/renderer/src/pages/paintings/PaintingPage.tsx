import type { PaintingCanvas } from '@renderer/types'
import { type FC, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import PaintingPageShell from './components/PaintingPageShell'
import PaintingSettingsSidebar from './components/PaintingSettingsSidebar'
import type { ModelConfig, ModelOption } from './hooks/useModelLoader'
import { useModelLoader } from './hooks/useModelLoader'
import { usePaintingPage } from './hooks/usePaintingPage'
import type { GenerateContext, PaintingProviderDefinition } from './providers/types'

interface PaintingPageProps {
  definition: PaintingProviderDefinition
  Options: string[]
  onProviderChange: (providerId: string) => void
}

const PaintingPage: FC<PaintingPageProps> = ({ definition, Options, onProviderChange }) => {
  const { t } = useTranslation()
  const [mode, setMode] = useState(definition.defaultMode || definition.modes?.[0]?.value || 'generate')

  // Resolve model config (may depend on mode)
  const modelConfig: ModelConfig = useMemo(() => {
    return typeof definition.models === 'function' ? definition.models(mode) : definition.models
  }, [definition, mode])

  // Ref that always holds the latest loaded model options
  // Used by getDefaultPainting so new paintings get the right default model
  const modelOptionsRef = useRef<ModelOption[]>([])

  // Get default painting factory (stable across renders, reads latest models via ref)
  const getDefaultPainting = useCallback(() => {
    return definition.getDefaultPainting(mode, modelOptionsRef.current.length > 0 ? modelOptionsRef.current : undefined)
  }, [definition, mode])

  // Determine DB mode
  const dbMode = useMemo(() => {
    return definition.modeToDbMode ? definition.modeToDbMode(mode) : (mode as any)
  }, [definition, mode])

  // Core page state
  const pageState = usePaintingPage({
    providerId: definition.providerId,
    mode: dbMode,
    getDefaultPainting,
    onProviderChange
  })

  // Model loading
  const { modelOptions, isLoadingModels } = useModelLoader(modelConfig, pageState.provider)

  // Keep ref in sync with latest model options
  modelOptionsRef.current = modelOptions

  // Model change handler
  const handleModelChange = useCallback(
    (modelId: string) => {
      if (definition.onModelChange) {
        const updates = definition.onModelChange(modelId, pageState.painting, modelOptions)
        pageState.patchPainting({ model: modelId, ...updates } as Partial<PaintingCanvas>)
      } else {
        pageState.patchPainting({ model: modelId } as Partial<PaintingCanvas>)
      }
    },
    [definition, pageState, modelOptions]
  )

  // Resolve config items for current mode
  const configItems = useMemo(() => {
    if (Array.isArray(definition.configFields)) {
      return definition.configFields
    }
    return definition.configFields[mode] || []
  }, [definition.configFields, mode])

  // Mode tabs
  const modeTabs = useMemo(() => {
    if (!definition.modes) return undefined
    return {
      options: definition.modes.map((m) => ({ label: t(m.labelKey), value: m.value })),
      value: mode,
      onChange: (value: string) => {
        setMode(value)
        pageState.setSelectedPaintingId(undefined)
      }
    }
  }, [definition, mode, t, pageState])

  // onGenerate wrapper
  const onGenerate = useCallback(async () => {
    const controller = new AbortController()
    pageState.setAbortController(controller)

    const ctx: GenerateContext = {
      painting: pageState.painting,
      provider: pageState.provider,
      abortController: controller,
      patchPainting: pageState.patchPainting,
      setFallbackUrls: pageState.setFallbackUrls,
      setIsLoading: pageState.setIsLoading,
      setGenerating: pageState.setGenerating,
      t,
      mode
    }

    try {
      await definition.onGenerate(ctx)
    } finally {
      pageState.setAbortController(null)
    }
  }, [definition, pageState, t, mode])

  // Image upload handlers
  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      if (definition.onImageUpload) {
        definition.onImageUpload(key, file, pageState.patchPainting as (updates: Partial<PaintingCanvas>) => void)
      }
    },
    [definition, pageState.patchPainting]
  )

  const getImagePreviewSrc = useCallback(
    (key: string) => {
      if (definition.getImagePreviewSrc) {
        return definition.getImagePreviewSrc(key, pageState.painting)
      }
      return undefined
    },
    [definition, pageState.painting]
  )

  // Build sidebar
  const sidebarContent = (
    <PaintingSettingsSidebar
      provider={pageState.provider}
      options={Options}
      onProviderChange={pageState.handleProviderChange}
      providerHeaderExtra={definition.providerHeaderExtra?.(pageState.provider, t)}
      modelSelect={
        modelOptions.length > 0
          ? {
              value: pageState.painting.model || '',
              options: modelOptions,
              onChange: handleModelChange,
              loading: isLoadingModels,
              placeholder: isLoadingModels ? t('common.loading') : t('paintings.select_model')
            }
          : null
      }
      configItems={configItems}
      painting={pageState.painting as Record<string, unknown>}
      onConfigChange={(updates) => pageState.patchPainting(updates as Partial<PaintingCanvas>)}
      onImageUpload={definition.onImageUpload ? handleImageUpload : undefined}
      getImagePreviewSrc={definition.getImagePreviewSrc ? getImagePreviewSrc : undefined}
      imagePlaceholder={definition.imagePlaceholder}
      extraContent={definition.sidebarExtra?.({
        painting: pageState.painting,
        mode,
        modelOptions,
        isLoading: pageState.isLoading,
        patchPainting: pageState.patchPainting,
        t
      })}
    />
  )

  // Resolve prompt overrides
  const promptPlaceholder = definition.promptPlaceholder
    ? definition.promptPlaceholder(pageState.painting, t, pageState.isTranslating)
    : undefined

  const promptDisabled = definition.promptDisabled
    ? definition.promptDisabled(pageState.painting, pageState.isLoading)
    : undefined

  return (
    <PaintingPageShell
      pageState={pageState}
      sidebarContent={sidebarContent}
      onGenerate={onGenerate}
      modeTabs={modeTabs}
      artboardProps={definition.artboardOverrides?.(pageState.painting, { mode, modelOptions })}
      centerContent={definition.centerContent?.({
        painting: pageState.painting,
        mode,
        modelOptions,
        isLoading: pageState.isLoading,
        currentImageIndex: pageState.currentImageIndex,
        prevImage: pageState.prevImage,
        nextImage: pageState.nextImage,
        onCancel: pageState.onCancel,
        t
      })}
      showTranslate={definition.showTranslate}
      promptPlaceholder={promptPlaceholder}
      promptDisabled={promptDisabled}
    />
  )
}

export default PaintingPage
