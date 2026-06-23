import { useCache } from '@data/hooks/useCache'
import CreationGallery from '@renderer/pages/creation/CreationGallery'
import CreationModelSelector, {
  type CreationModelKindSelection,
  type CreationModelSelection
} from '@renderer/pages/creation/CreationModelSelector'
import { creationClasses } from '@renderer/pages/creation/creationPrimitives'
import CreationWorkspace from '@renderer/pages/creation/CreationWorkspace'
import type { CreationData } from '@renderer/pages/creation/types'
import { useCreationHistory } from '@renderer/pages/creation/useCreationHistory'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Artboard from './components/Artboard'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingSettings from './components/PaintingSettings'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingInitialProvider } from './hooks/usePaintingInitialProvider'
import { usePaintingInitialSelection } from './hooks/usePaintingInitialSelection'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import { createDefaultPainting } from './model/paintingPipeline'
import type { PaintingData } from './model/types/paintingData'
import { cacheToPaintingGenerationState } from './model/utils/paintingGenerationParams'

interface ImageCreationModeProps {
  initialSelection?: CreationModelSelection
  initialCreationItem?: CreationData
  onModelKindSelect?: (selection: CreationModelKindSelection) => void
  onCreationKindSelect?: (item: CreationData) => void
}

const ImageCreationMode: FC<ImageCreationModeProps> = ({
  initialSelection,
  initialCreationItem,
  onModelKindSelect = () => {},
  onCreationKindSelect = () => {}
}) => {
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId } = usePaintingInitialProvider(providerOptions)

  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() => createDefaultPainting(initialProviderId))

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }) as PaintingData)
  }, [])

  const history = useCreationHistory()
  const imageHistoryItems = useMemo(() => history.items.filter((item) => item.kind === 'image'), [history.items])

  usePaintingInitialSelection({
    currentPainting,
    historyItems: imageHistoryItems,
    initialProviderId,
    setCurrentPainting
  })

  // Rehydrate the running spinner after a page switch: the cache mirror of
  // generation state survives unmount, so re-mounting picks it back up.
  const [cachedGeneration] = useCache(`painting.generation.${currentPainting.id}`)
  const liveGenerationState = useMemo(() => cacheToPaintingGenerationState(cachedGeneration), [cachedGeneration])

  const currentProviderId = currentPainting.providerId || initialProviderId

  const modelCatalog = usePaintingModelCatalog({
    providerOptions,
    painting: currentPainting
  })

  const {
    generating: liveGenerating,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    painting: currentPainting,
    onPaintingChange: setCurrentPainting,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  // After a page switch the local `liveGenerating` boots false because
  // `usePaintingGeneration` reads from `painting.generationStatus` — the
  // painting record is a frozen receipt with no status. The cache fills the
  // gap: if its `status === 'running'` for this painting, keep the spinner.
  const generating = liveGenerating || liveGenerationState.generationStatus === 'running'

  const switchModel = usePaintingModelSwitch({
    painting: currentPainting,
    onPaintingChange: patchPainting,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const appliedInitialSelectionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialSelection) return
    const key = `${initialSelection.providerId}::${initialSelection.modelId}`
    if (appliedInitialSelectionRef.current === key) return
    appliedInitialSelectionRef.current = key
    void switchModel(initialSelection)
  }, [initialSelection, switchModel])

  const appliedInitialCreationItemRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialCreationItem || initialCreationItem.kind !== 'image') return
    if (appliedInitialCreationItemRef.current === initialCreationItem.id) return
    appliedInitialCreationItemRef.current = initialCreationItem.id
    setCurrentPainting(initialCreationItem)
  }, [initialCreationItem])

  const onSelectModel = useCallback(
    (selection: CreationModelKindSelection) => {
      if (selection.kind === 'video') {
        onModelKindSelect(selection)
        return
      }
      void switchModel(selection)
    },
    [onModelKindSelect, switchModel]
  )

  const list = usePaintingList({
    painting: currentPainting,
    setCurrentPainting,
    currentProviderId,
    modelOptions: modelCatalog.currentModelOptions,
    historyItems: imageHistoryItems,
    cancelGeneration
  })

  const onSelectCreationItem = useCallback(
    (item: CreationData) => {
      if (item.kind === 'video') {
        onCreationKindSelect(item)
        return
      }
      void list.select(item)
    },
    [list, onCreationKindSelect]
  )

  const onCancel = useCallback(() => cancelGeneration(currentPainting.id), [cancelGeneration, currentPainting.id])
  const saveCurrentRef = useRef(list.saveCurrent)
  saveCurrentRef.current = list.saveCurrent

  useEffect(() => {
    return () => {
      void saveCurrentRef.current()
    }
  }, [])

  return (
    <CreationWorkspace
      modelSelector={
        <CreationModelSelector
          className={creationClasses.panelModelSelectorTrigger}
          providerId={currentPainting.providerId}
          modelId={currentPainting.model}
          onSelect={onSelectModel}
        />
      }
      settings={
        <PaintingSettings
          painting={currentPainting}
          onConfigChange={patchPainting}
          onGenerateRandomSeed={(key) =>
            patchPainting({
              params: {
                ...currentPainting.params,
                [key]: String(Math.floor(Math.random() * 1_000_000))
              }
            })
          }
        />
      }
      artboard={<Artboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />}
      promptBar={
        <PaintingPromptBar
          painting={currentPainting}
          generating={generating}
          onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
          onInputFilesChange={(inputFiles) => patchPainting({ inputFiles } as Partial<PaintingData>)}
          onGenerate={submit}
        />
      }
      historyStrip={
        <CreationGallery
          kind="image"
          selectedCreationId={currentPainting.id}
          runningCreationId={generating ? currentPainting.id : undefined}
          items={history.items}
          hasMore={history.hasMore}
          loadMore={history.loadMore}
          onDeleteCreation={list.remove}
          onSelectCreation={onSelectCreationItem}
          onAddCreation={list.add}
        />
      }
    />
  )
}

export default ImageCreationMode
