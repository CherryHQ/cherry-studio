import './painting-theme.css'

import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useProviders } from '@renderer/hooks/useProviders'
import FileManager from '@renderer/services/FileManager'
import type { PaintingMode } from '@shared/data/types/painting'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import PaintingModelSelector from './components/PaintingModelSelector'
import PaintingPromptBar from './components/PaintingPromptBar'
import { PaintingPromptLeadingActions } from './components/PaintingPromptLeadingActions'
import { PaintingArtboard, PaintingProviderHeaderActions } from './components/PaintingProviderViews'
import PaintingSettings, { PaintingSettingsHeader } from './components/PaintingSettings'
import PaintingStrip from './components/PaintingStrip'
import { usePaintingModelSelectorCatalog } from './components/usePaintingModelSelectorCatalog'
import { usePaintingGeneration } from './hooks/usePaintingGeneration'
import { usePaintingGenerationGuard } from './hooks/usePaintingGenerationGuard'
import { usePaintingPromptPlaceholder } from './hooks/usePaintingPromptPlaceholder'
import { usePaintingProviderRuntime } from './hooks/usePaintingProviderRuntime'
import { presentPaintingGenerateError } from './model/errors/paintingGenerateError'
import { paintingDataToCreateDto } from './model/mappers/paintingDataToCreateDto'
import { recordToPaintingData } from './model/mappers/recordToPaintingData'
import type { PaintingData } from './model/types/paintingData'
import type { ModelOption } from './model/types/paintingModel'
import { isPaintingNewApiProvider } from './model/types/paintingProviderRuntime'
import { paintingClasses } from './PaintingPrimitives'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from './utils/paintingProviderMode'
import { presentPaintingGenerationGuardFeedback } from './utils/presentPaintingGenerationGuardFeedback'
import { getValidPaintingOptions, resolvePaintingProvider } from './utils/providerSelection'

const BASE_OPTIONS = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms', 'ppio']
const FALLBACK_PROVIDER = 'zhipu'

function hasOutput(painting: PaintingData) {
  return (painting.files?.length ?? 0) > 0
}

const PaintingPage: FC = () => {
  const { providers: allProviders } = useProviders()
  const [defaultPaintingProvider, setDefaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const { createPainting, deletePainting, refresh } = usePaintings()
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isParametersOpen, setIsParametersOpen] = useState(true)
  const providerOptions = useMemo(
    () => [
      ...new Set([...BASE_OPTIONS, ...allProviders.filter(isPaintingNewApiProvider).map((provider) => provider.id)])
    ],
    [allProviders]
  )
  const [isOvmsSupported, setIsOvmsSupported] = useState(false)
  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')
  const validProviderOptions = useMemo(
    () => getValidPaintingOptions(providerOptions, isOvmsSupported, ovmsStatus),
    [isOvmsSupported, ovmsStatus, providerOptions]
  )
  const initialProviderId = useMemo(
    () =>
      resolvePaintingProvider(undefined, defaultPaintingProvider ?? undefined, validProviderOptions) ??
      FALLBACK_PROVIDER,
    [defaultPaintingProvider, validProviderOptions]
  )
  const initialProviderDefinition = useMemo(
    () => resolvePaintingProviderDefinition(initialProviderId),
    [initialProviderId]
  )
  const [tab, setTab] = useState(initialProviderDefinition.mode.defaultTab)
  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() =>
    initialProviderDefinition.mode.createPaintingData({ tab: initialProviderDefinition.mode.defaultTab })
  )
  const [isCurrentPaintingPersisted, setIsCurrentPaintingPersisted] = useState(false)
  const modelOptionsRef = useRef<ModelOption[]>([])
  const [hasUserTouchedPainting, setHasUserTouchedPainting] = useState(false)

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setHasUserTouchedPainting(true)
    setCurrentPainting((current) => ({ ...current, ...updates }) as PaintingData)
  }, [])

  useEffect(() => {
    const checkOvms = async () => {
      const supported = await window.api.ovms.isSupported()
      setIsOvmsSupported(supported)
      if (supported) {
        setOvmsStatus(await window.api.ovms.getStatus())
      }
    }

    void checkOvms()
  }, [])

  useEffect(() => {
    if (initialProviderId !== defaultPaintingProvider) {
      void setDefaultPaintingProvider(initialProviderId)
    }
  }, [defaultPaintingProvider, initialProviderId, setDefaultPaintingProvider])

  const currentProviderId = currentPainting.providerId || initialProviderId
  const currentProviderDefinition = useMemo(
    () => resolvePaintingProviderDefinition(currentProviderId),
    [currentProviderId]
  )
  const { provider: currentProvider } = usePaintingProviderRuntime(currentProviderId)

  useEffect(() => {
    const allowedTabs = currentProviderDefinition.mode.tabs.map((item) => item.value)
    if (!allowedTabs.includes(tab)) {
      setTab(currentProviderDefinition.mode.defaultTab)
    }
  }, [currentProviderDefinition.mode.defaultTab, currentProviderDefinition.mode.tabs, tab])

  const currentTab = useMemo(
    () => resolvePaintingTabForMode(currentProviderDefinition, currentPainting.mode) ?? tab,
    [currentProviderDefinition, currentPainting.mode, tab]
  )
  const modelCatalog = usePaintingModelSelectorCatalog({
    providerOptions: validProviderOptions,
    currentProviderId,
    currentMode: currentPainting.mode,
    currentModelId: currentPainting.model,
    isOpen: isModelSelectorOpen
  })
  const modelOptions = modelCatalog.currentModelOptions
  modelOptionsRef.current = modelOptions

  const { validateBeforeGenerate } = usePaintingGenerationGuard({
    providerId: currentProviderId,
    mode: currentPainting.mode,
    modelId: currentPainting.model,
    provider: currentProvider,
    selectorData: modelCatalog.selectorData,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })
  const { generate, cancel, generating } = usePaintingGeneration({
    painting: currentPainting,
    persisted: isCurrentPaintingPersisted,
    provider: currentProvider,
    definition: currentProviderDefinition,
    tab: currentTab,
    setPainting: setCurrentPainting,
    setPersisted: setIsCurrentPaintingPersisted
  })

  const handleModelChange = useCallback(
    (modelId: string) => {
      const modelUpdates = currentProviderDefinition.fields.onModelChange?.({
        modelId,
        painting: currentPainting,
        modelOptions
      })
      patchPainting({ model: modelId, ...modelUpdates } as Partial<PaintingData>)
    },
    [currentProviderDefinition.fields, modelOptions, currentPainting, patchPainting]
  )

  const handleModelSelectorChange = useCallback(
    async ({ providerId, modelId }: { providerId: string; modelId: string }) => {
      setHasUserTouchedPainting(true)

      if (providerId === currentProviderId) {
        handleModelChange(modelId)
        return
      }

      const targetDefinition = resolvePaintingProviderDefinition(providerId)
      const targetTab = resolvePaintingTabForMode(targetDefinition, currentPainting.mode)
      if (!targetTab) return

      const targetDbMode = targetDefinition.mode.tabToDbMode(targetTab)
      const targetModelOptions = await modelCatalog.ensureProviderCatalog(providerId)
      const targetPainting =
        providerId === currentPainting.providerId
          ? currentPainting
          : targetDefinition.mode.createPaintingData({ tab: targetTab, modelOptions: targetModelOptions })
      const modelUpdates = targetDefinition.fields.onModelChange?.({
        modelId,
        painting: targetPainting,
        modelOptions: targetModelOptions
      })

      patchPainting({
        ...targetPainting,
        id: currentPainting.id,
        files: currentPainting.files,
        prompt: currentPainting.prompt,
        providerId,
        mode: targetDbMode,
        model: modelId,
        ...modelUpdates
      } as Partial<PaintingData>)
    },
    [currentProviderId, handleModelChange, modelCatalog, currentPainting, patchPainting]
  )

  const handleAddPainting = useCallback(async () => {
    setHasUserTouchedPainting(true)
    const nextPainting = currentProviderDefinition.mode.createPaintingData({
      tab: currentTab,
      modelOptions: modelOptionsRef.current.length > 0 ? modelOptionsRef.current : undefined
    })
    setCurrentPainting(nextPainting)
    setIsCurrentPaintingPersisted(false)

    try {
      const createdRecord = await createPainting(
        paintingDataToCreateDto(nextPainting as PaintingData & { providerId: string; mode: PaintingMode })
      )
      setCurrentPainting(await recordToPaintingData(createdRecord))
      setIsCurrentPaintingPersisted(true)
      await refresh()
    } catch (error) {
      presentPaintingGenerateError(error)
    }
  }, [createPainting, currentProviderDefinition.mode, currentTab, refresh])

  const handleSelectHistoryPainting = useCallback((painting: PaintingData) => {
    setHasUserTouchedPainting(true)
    setCurrentPainting(painting)
    setIsCurrentPaintingPersisted(true)
    const selectedDefinition = resolvePaintingProviderDefinition(painting.providerId)
    const selectedTab = resolvePaintingTabForMode(selectedDefinition, painting.mode)
    if (selectedTab) {
      setTab(selectedTab)
    }
  }, [])

  const chooseNextPaintingAfterDelete = useCallback(
    async (deletedId: string) => {
      const response = (await refresh()) as { items?: Parameters<typeof recordToPaintingData>[0][] } | undefined
      const nextRecord = response?.items?.find((item) => item.id !== deletedId)
      if (nextRecord) {
        setCurrentPainting(await recordToPaintingData(nextRecord))
        setIsCurrentPaintingPersisted(true)
        return
      }
      await handleAddPainting()
    },
    [handleAddPainting, refresh]
  )

  const handleDeletePainting = useCallback(
    async (painting: PaintingData) => {
      cancel(painting.id)
      await FileManager.deleteFiles(painting.files ?? [])
      await deletePainting(painting.id)
      if (painting.id === currentPainting.id) {
        await chooseNextPaintingAfterDelete(painting.id)
      } else {
        await refresh()
      }
    },
    [cancel, chooseNextPaintingAfterDelete, currentPainting.id, deletePainting, refresh]
  )

  const onGenerate = useCallback(async () => {
    const guardResult = await validateBeforeGenerate()
    if (!guardResult.ok) {
      presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error)
      return
    }

    await generate()
  }, [generate, validateBeforeGenerate])

  const onCancel = useCallback(() => {
    cancel(currentPainting.id)
  }, [cancel, currentPainting.id])

  const modeTabs = useMemo(() => {
    if (currentProviderDefinition.mode.tabs.length <= 1) {
      return undefined
    }
    return {
      tabs: currentProviderDefinition.mode.tabs.map((item) => ({ labelKey: item.labelKey, value: item.value })),
      value: currentTab,
      onValueChange: (value: string) => {
        setTab(value)
        const nextMode = currentProviderDefinition.mode.tabToDbMode(value)
        patchPainting({ mode: nextMode } as Partial<PaintingData>)
      }
    }
  }, [currentProviderDefinition.mode, currentTab, patchPainting])

  const promptPlaceholder = usePaintingPromptPlaceholder(currentProviderDefinition, currentPainting)
  const promptDisabled = currentProviderDefinition.prompt?.disabled
    ? currentProviderDefinition.prompt.disabled({
        painting: currentPainting,
        isLoading: generating
      })
    : undefined

  return (
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className="flex h-full flex-1 flex-col bg-white dark:bg-background">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <div
                className={cn(
                  paintingClasses.panel,
                  isParametersOpen ? paintingClasses.panelVisible : paintingClasses.panelHidden
                )}>
                <div className={paintingClasses.panelHeader}>
                  <PaintingSettingsHeader
                    actions={<PaintingProviderHeaderActions provider={currentProvider} />}
                    onClose={() => setIsParametersOpen(false)}
                  />
                </div>
                <div className={paintingClasses.panelBody}>
                  <Scrollbar className={paintingClasses.panelScroll}>
                    <PaintingSettings
                      provider={currentProvider}
                      modelOptions={modelOptions}
                      selectedModelOption={modelCatalog.selectedModelOption}
                      isLoading={generating}
                      tab={currentTab}
                      painting={currentPainting}
                      onConfigChange={patchPainting}
                    />
                  </Scrollbar>
                </div>
              </div>

              <div className={paintingClasses.centerPane}>
                <PaintingArtboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />
              </div>

              <PaintingStrip
                selectedPaintingId={currentPainting.id}
                canSelectInitialPainting={
                  !hasUserTouchedPainting &&
                  !isCurrentPaintingPersisted &&
                  !currentPainting.prompt.trim() &&
                  !hasOutput(currentPainting)
                }
                onDeletePainting={handleDeletePainting}
                onSelectPainting={handleSelectHistoryPainting}
                onAddPainting={handleAddPainting}
              />
            </div>
          </div>

          <PaintingPromptBar
            prompt={currentPainting.prompt || ''}
            disabled={promptDisabled ?? generating}
            leadingActions={
              <PaintingPromptLeadingActions
                modeTabs={modeTabs}
                onToggleParameters={() => setIsParametersOpen((open) => !open)}
              />
            }
            modelSelector={
              <PaintingModelSelector
                currentProviderId={currentProviderId}
                open={isModelSelectorOpen}
                onOpenChange={setIsModelSelectorOpen}
                selectorData={modelCatalog.selectorData}
                isLoading={modelCatalog.isLoading}
                onSelect={handleModelSelectorChange}
              />
            }
            placeholder={promptPlaceholder}
            onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
            onGenerate={onGenerate}
          />
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
