import { cacheService } from '@data/CacheService'
import { useCache } from '@data/hooks/useCache'
import { useAllProviders } from '@renderer/hooks/useProvider'
import type { Provider } from '@renderer/types/provider'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import PaintingModelSelector from '../components/PaintingModelSelector'
import { usePaintingModelSelectorCatalog } from '../components/usePaintingModelSelectorCatalog'
import type { ModelOption } from '../hooks/useModelLoader'
import { useModelLoader } from '../hooks/useModelLoader'
import { createPaintingGenerateError, presentPaintingGenerateError } from '../model/errors/paintingGenerateError'
import {
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/runtime/paintingAbortControllerStore'
import {
  clearPendingPaintingModelSelection,
  getPaintingModeCacheKey,
  getPaintingSelectionCacheKey
} from '../model/runtime/paintingRuntimeStore'
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
import { type PaintingGenerationGuardReason, usePaintingGenerationGuard } from './hooks/usePaintingGenerationGuard'
import type { PaintingHistoryItem } from './hooks/usePaintingHistoryStrip'
import { usePaintingWorkspace } from './hooks/usePaintingWorkspace'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from './utils/paintingProviderMode'

interface PaintingWorkspaceProps {
  definition: PaintingProvider
  options: string[]
  onProviderChange: (providerId: string) => void
}

const PaintingWorkspace: FC<PaintingWorkspaceProps> = ({ definition, options, onProviderChange }) => {
  const { t } = useTranslation()
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [tab, setTab] = useCache(getPaintingModeCacheKey(definition.id), definition.mode.defaultTab)
  const allProviders = useAllProviders()

  useEffect(() => {
    const allowedTabs = definition.mode.tabs.map((item) => item.value)
    if (!allowedTabs.includes(tab)) {
      setTab(definition.mode.defaultTab)
    }
  }, [definition.mode.defaultTab, definition.mode.tabs, setTab, tab])

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

  const runtimeProviderId = workspaceState.painting.runtimeProviderId || definition.id
  const runtimeDefinition = useMemo(() => resolvePaintingProviderDefinition(runtimeProviderId), [runtimeProviderId])
  const runtimeTab = useMemo(
    () => resolvePaintingTabForMode(runtimeDefinition, dbMode) ?? runtimeDefinition.mode.defaultTab,
    [dbMode, runtimeDefinition]
  )
  const runtimeProvider = useMemo(
    () =>
      (allProviders.find((provider) => provider.id === runtimeProviderId) ?? {
        id: runtimeProviderId,
        name: runtimeProviderId,
        models: []
      }) as Provider,
    [allProviders, runtimeProviderId]
  )
  const modelConfig = useMemo(() => runtimeDefinition.mode.getModels(runtimeTab), [runtimeDefinition.mode, runtimeTab])
  const { modelOptions, isLoadingModels } = useModelLoader(modelConfig, runtimeProvider)
  if (runtimeProviderId === definition.id) {
    modelOptionsRef.current = modelOptions
  }

  const modelCatalog = usePaintingModelSelectorCatalog({
    providerOptions: options,
    currentProviderId: runtimeProviderId,
    currentMode: dbMode,
    currentModelId: workspaceState.painting.model,
    currentModelOptions: modelOptions,
    isCurrentLoading: isLoadingModels,
    isOpen: isModelSelectorOpen
  })

  const { validateBeforeGenerate } = usePaintingGenerationGuard({
    providerId: runtimeProviderId,
    mode: dbMode,
    modelId: workspaceState.painting.model,
    provider: runtimeProvider,
    selectorData: modelCatalog.selectorData,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  const handleModelChange = useCallback(
    (modelId: string) => {
      if (runtimeDefinition.fields.onModelChange) {
        const updates = runtimeDefinition.fields.onModelChange({
          modelId,
          painting: workspaceState.painting,
          modelOptions
        })
        workspaceState.patchPainting({ runtimeProviderId, model: modelId, ...updates } as Partial<PaintingData>)
      } else {
        workspaceState.patchPainting({ runtimeProviderId, model: modelId } as Partial<PaintingData>)
      }
    },
    [modelOptions, runtimeDefinition.fields, runtimeProviderId, workspaceState]
  )

  const configItems = useMemo(
    () => runtimeDefinition.fields.byTab[runtimeTab] || [],
    [runtimeDefinition.fields.byTab, runtimeTab]
  )

  useEffect(() => {
    clearPendingPaintingModelSelection()
  }, [])

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

  const handleModelSelectorChange = useCallback(
    async ({ providerId, modelId }: { providerId: string; modelId: string }) => {
      if (providerId === runtimeProviderId) {
        handleModelChange(modelId)
        return
      }

      const targetDefinition = resolvePaintingProviderDefinition(providerId)
      const targetTab = resolvePaintingTabForMode(targetDefinition, dbMode)
      if (!targetTab) {
        return
      }

      const targetModelOptions = await modelCatalog.ensureProviderCatalog(providerId)
      const modelUpdates = targetDefinition.fields.onModelChange
        ? targetDefinition.fields.onModelChange({
            modelId,
            painting: workspaceState.painting,
            modelOptions: targetModelOptions
          })
        : undefined

      workspaceState.patchPainting({
        runtimeProviderId: providerId,
        model: modelId,
        ...modelUpdates
      } as Partial<PaintingData>)
    },
    [dbMode, handleModelChange, modelCatalog, runtimeProviderId, workspaceState]
  )

  const handleHistoryPaintingSelect = useCallback(
    (targetPainting: PaintingHistoryItem) => {
      const targetProviderId = targetPainting.providerId || definition.id
      const targetDefinition = resolvePaintingProviderDefinition(targetProviderId)
      const targetTab = resolvePaintingTabForMode(targetDefinition, targetPainting.dbMode)

      if (!targetTab) {
        return
      }

      const targetSelectionScope = `${targetProviderId}_${targetPainting.dbMode}`
      cacheService.set(getPaintingModeCacheKey(targetProviderId), targetTab)
      cacheService.set(getPaintingSelectionCacheKey(targetSelectionScope), targetPainting.id)
      clearPendingPaintingModelSelection()

      if (targetProviderId !== definition.id) {
        workspaceState.handleProviderChange(targetProviderId)
        return
      }

      if (targetTab !== tab) {
        setTab(targetTab)
        return
      }

      workspaceState.onSelectPainting(targetPainting)
    },
    [definition.id, setTab, tab, workspaceState]
  )

  const presentGuardBlock = useCallback(
    (reason: PaintingGenerationGuardReason, error?: Error) => {
      if (reason === 'provider_disabled') {
        presentPaintingGenerateError(createPaintingGenerateError('PROVIDER_DISABLED'), t)
        return
      }

      if (reason === 'catalog_error') {
        window.toast.error(error?.message || t('paintings.req_error_model'))
        return
      }

      if (reason === 'model_unavailable') {
        window.toast.error(t('paintings.req_error_model'))
        return
      }

      window.toast.error(t('paintings.select_model'))
    },
    [t]
  )

  const onGenerate = useCallback(async () => {
    const guardResult = await validateBeforeGenerate()
    if (!guardResult.ok) {
      presentGuardBlock(guardResult.reason, guardResult.error)
      return
    }

    const controller = new AbortController()
    const targetPaintingId = workspaceState.painting.id
    registerPaintingAbortController(targetPaintingId, controller)

    const ctx: GenerateContext = {
      input: {
        painting: workspaceState.painting,
        provider: runtimeProvider,
        tab: runtimeTab,
        abortController: controller
      },
      writers: {
        patchPainting: (updates) => workspaceState.patchPaintingById(targetPaintingId, updates),
        setFallbackUrls: (urls) => workspaceState.setFallbackUrlsForPainting(targetPaintingId, urls),
        setIsLoading: (value) => workspaceState.setIsLoadingForPainting(targetPaintingId, value)
      }
    }

    try {
      await runtimeDefinition.generate(ctx)
    } catch (error) {
      presentPaintingGenerateError(error, t)
    } finally {
      clearPaintingAbortController(targetPaintingId, controller)
    }
  }, [presentGuardBlock, runtimeDefinition, runtimeProvider, runtimeTab, t, validateBeforeGenerate, workspaceState])

  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      runtimeDefinition.image?.onUpload?.({
        key,
        file,
        patchPainting: workspaceState.patchPainting as (updates: Partial<PaintingData>) => void
      })
    },
    [runtimeDefinition.image, workspaceState.patchPainting]
  )

  const getImagePreviewSrc = useCallback(
    (key: string) => {
      return runtimeDefinition.image?.getPreviewSrc?.({
        key,
        painting: workspaceState.painting
      })
    },
    [runtimeDefinition.image, workspaceState.painting]
  )

  const sidebarSlotState: SidebarSlotState = {
    tab: runtimeTab,
    painting: workspaceState.painting,
    modelOptions,
    isLoading: workspaceState.isLoading,
    patchPainting: workspaceState.patchPainting,
    t
  }

  const centerSlotState: CenterSlotState = {
    tab: runtimeTab,
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
    tab: runtimeTab,
    painting: workspaceState.painting,
    modelOptions
  }

  const sidebarContent = (
    <PaintingSidebar
      providerHeaderExtra={runtimeDefinition.slots?.headerExtra?.(runtimeProvider, t)}
      modelSelect={null}
      showProviderSection={false}
      showModelSection={false}
      configItems={configItems}
      painting={workspaceState.painting as unknown as Record<string, unknown>}
      onConfigChange={(updates) => workspaceState.patchPainting(updates as Partial<PaintingData>)}
      onImageUpload={runtimeDefinition.image?.onUpload ? handleImageUpload : undefined}
      getImagePreviewSrc={runtimeDefinition.image?.getPreviewSrc ? getImagePreviewSrc : undefined}
      imagePlaceholder={runtimeDefinition.image?.placeholder}
      extraContent={runtimeDefinition.slots?.sidebarExtra?.(sidebarSlotState)}
    />
  )

  const promptPlaceholder = runtimeDefinition.prompt?.placeholder
    ? runtimeDefinition.prompt.placeholder({
        painting: workspaceState.painting,
        t,
        isTranslating: workspaceState.isTranslating
      })
    : undefined

  const promptDisabled = runtimeDefinition.prompt?.disabled
    ? runtimeDefinition.prompt.disabled({
        painting: workspaceState.painting,
        isLoading: workspaceState.isLoading
      })
    : undefined

  return (
    <PaintingWorkspaceShell
      pageState={workspaceState}
      sidebarContent={sidebarContent}
      onGenerate={onGenerate}
      onSelectHistoryPainting={handleHistoryPaintingSelect}
      modeTabs={modeTabs}
      artboardProps={runtimeDefinition.slots?.artboardOverrides?.(artboardSlotState)}
      centerContent={runtimeDefinition.slots?.centerContent?.(centerSlotState)}
      promptModelSelector={
        <PaintingModelSelector
          currentProviderId={runtimeProviderId}
          open={isModelSelectorOpen}
          onOpenChange={setIsModelSelectorOpen}
          selectorData={modelCatalog.selectorData}
          isLoading={modelCatalog.isLoading}
          onSelect={handleModelSelectorChange}
        />
      }
      showTranslate={runtimeDefinition.prompt?.translateShortcut}
      promptPlaceholder={promptPlaceholder}
      promptDisabled={promptDisabled}
    />
  )
}

export default PaintingWorkspace
