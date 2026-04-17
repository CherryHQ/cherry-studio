import { useCache } from '@data/hooks/useCache'
import { type FC, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelOption } from '../hooks/useModelLoader'
import { useModelLoader } from '../hooks/useModelLoader'
import { presentPaintingGenerateError } from '../model/errors/paintingGenerateError'
import {
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/runtime/paintingAbortControllerStore'
import { getPaintingModeCacheKey } from '../model/runtime/paintingRuntimeStore'
import type { PaintingData } from '../model/types/paintingData'
import type {
  ArtboardSlotState,
  CenterSlotState,
  GenerateContext,
  PaintingProvider,
  SidebarSlotState
} from '../providers/shared/provider'
import PaintingSidebar from './components/PaintingSidebar'
import PaintingWorkspaceShell from './components/PaintingWorkspaceShell'
import { usePaintingWorkspace } from './hooks/usePaintingWorkspace'

interface PaintingWorkspaceProps {
  definition: PaintingProvider
  options: string[]
  onProviderChange: (providerId: string) => void
}

const PaintingWorkspace: FC<PaintingWorkspaceProps> = ({ definition, options, onProviderChange }) => {
  const { t } = useTranslation()
  const [tab, setTab] = useCache(getPaintingModeCacheKey(definition.id), definition.mode.defaultTab)

  useEffect(() => {
    const allowedTabs = definition.mode.tabs.map((item) => item.value)
    if (!allowedTabs.includes(tab)) {
      setTab(definition.mode.defaultTab)
    }
  }, [definition.mode.defaultTab, definition.mode.tabs, setTab, tab])

  const modelConfig = useMemo(() => definition.mode.getModels(tab), [definition.mode, tab])
  const modelOptionsRef = useRef<ModelOption[]>([])

  const createDefaultPaintingData = useCallback(() => {
    return definition.mode.createPaintingData({
      tab,
      modelOptions: modelOptionsRef.current.length > 0 ? modelOptionsRef.current : undefined
    })
  }, [definition.mode, tab])

  const dbMode = useMemo(() => definition.mode.tabToDbMode(tab), [definition.mode, tab])

  const workspaceState = usePaintingWorkspace({
    providerId: definition.id,
    mode: dbMode,
    createDefaultPaintingData,
    onProviderChange
  })

  const { modelOptions, isLoadingModels } = useModelLoader(modelConfig, workspaceState.provider)
  modelOptionsRef.current = modelOptions

  const handleModelChange = useCallback(
    (modelId: string) => {
      if (definition.fields.onModelChange) {
        const updates = definition.fields.onModelChange({
          modelId,
          painting: workspaceState.painting,
          modelOptions
        })
        workspaceState.patchPainting({ model: modelId, ...updates } as Partial<PaintingData>)
      } else {
        workspaceState.patchPainting({ model: modelId } as Partial<PaintingData>)
      }
    },
    [definition.fields, modelOptions, workspaceState]
  )

  const configItems = useMemo(() => definition.fields.byTab[tab] || [], [definition.fields.byTab, tab])

  const modeTabs = useMemo(() => {
    if (definition.mode.tabs.length <= 1) {
      return undefined
    }

    return {
      options: definition.mode.tabs.map((item) => ({ label: t(item.labelKey), value: item.value })),
      value: tab,
      onChange: (value: string) => {
        setTab(value)
      }
    }
  }, [definition.mode.tabs, setTab, t, tab])

  const onGenerate = useCallback(async () => {
    const controller = new AbortController()
    const targetPaintingId = workspaceState.painting.id
    registerPaintingAbortController(targetPaintingId, controller)

    const ctx: GenerateContext = {
      input: {
        painting: workspaceState.painting,
        provider: workspaceState.provider,
        tab,
        abortController: controller
      },
      writers: {
        patchPainting: (updates) => workspaceState.patchPaintingById(targetPaintingId, updates),
        setFallbackUrls: (urls) => workspaceState.setFallbackUrlsForPainting(targetPaintingId, urls),
        setIsLoading: (value) => workspaceState.setIsLoadingForPainting(targetPaintingId, value)
      }
    }

    try {
      await definition.generate(ctx)
    } catch (error) {
      presentPaintingGenerateError(error, t)
    } finally {
      clearPaintingAbortController(targetPaintingId, controller)
    }
  }, [definition, t, tab, workspaceState])

  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      definition.image?.onUpload?.({
        key,
        file,
        patchPainting: workspaceState.patchPainting as (updates: Partial<PaintingData>) => void
      })
    },
    [definition.image, workspaceState.patchPainting]
  )

  const getImagePreviewSrc = useCallback(
    (key: string) => {
      return definition.image?.getPreviewSrc?.({
        key,
        painting: workspaceState.painting
      })
    },
    [definition.image, workspaceState.painting]
  )

  const sidebarSlotState: SidebarSlotState = {
    tab,
    painting: workspaceState.painting,
    modelOptions,
    isLoading: workspaceState.isLoading,
    patchPainting: workspaceState.patchPainting,
    t
  }

  const centerSlotState: CenterSlotState = {
    tab,
    painting: workspaceState.painting,
    modelOptions,
    isLoading: workspaceState.isLoading,
    currentImageIndex: workspaceState.currentImageIndex,
    prevImage: workspaceState.prevImage,
    nextImage: workspaceState.nextImage,
    onCancel: workspaceState.onCancel,
    t
  }

  const artboardSlotState: ArtboardSlotState = {
    tab,
    painting: workspaceState.painting,
    modelOptions
  }

  const sidebarContent = (
    <PaintingSidebar
      provider={workspaceState.provider}
      options={options}
      onProviderChange={workspaceState.handleProviderChange}
      providerHeaderExtra={definition.slots?.headerExtra?.(workspaceState.provider, t)}
      modelSelect={
        modelOptions.length > 0
          ? {
              value: workspaceState.painting.model || '',
              options: modelOptions,
              onChange: handleModelChange,
              loading: isLoadingModels,
              placeholder: isLoadingModels ? t('common.loading') : t('paintings.select_model')
            }
          : null
      }
      configItems={configItems}
      painting={workspaceState.painting as unknown as Record<string, unknown>}
      onConfigChange={(updates) => workspaceState.patchPainting(updates as Partial<PaintingData>)}
      onImageUpload={definition.image?.onUpload ? handleImageUpload : undefined}
      getImagePreviewSrc={definition.image?.getPreviewSrc ? getImagePreviewSrc : undefined}
      imagePlaceholder={definition.image?.placeholder}
      extraContent={definition.slots?.sidebarExtra?.(sidebarSlotState)}
    />
  )

  const promptPlaceholder = definition.prompt?.placeholder
    ? definition.prompt.placeholder({
        painting: workspaceState.painting,
        t,
        isTranslating: workspaceState.isTranslating
      })
    : undefined

  const promptDisabled = definition.prompt?.disabled
    ? definition.prompt.disabled({
        painting: workspaceState.painting,
        isLoading: workspaceState.isLoading
      })
    : undefined

  return (
    <PaintingWorkspaceShell
      pageState={workspaceState}
      sidebarContent={sidebarContent}
      onGenerate={onGenerate}
      modeTabs={modeTabs}
      artboardProps={definition.slots?.artboardOverrides?.(artboardSlotState)}
      centerContent={definition.slots?.centerContent?.(centerSlotState)}
      showTranslate={definition.prompt?.translateShortcut}
      promptPlaceholder={promptPlaceholder}
      promptDisabled={promptDisabled}
    />
  )
}

export default PaintingWorkspace
