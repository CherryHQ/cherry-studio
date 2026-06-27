import { useCache } from '@data/hooks/useCache'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Artboard from './components/Artboard'
import PaintingComposer from './components/PaintingComposer'
import PaintingStrip from './components/PaintingStrip'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingHistory } from './hooks/usePaintingHistory'
import { usePaintingInitialProvider } from './hooks/usePaintingInitialProvider'
import { usePaintingInitialSelection } from './hooks/usePaintingInitialSelection'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import { createDefaultPainting } from './model/paintingPipeline'
import type { PaintingData } from './model/types/paintingData'
import { cacheToPaintingGenerationState } from './model/utils/paintingGenerationParams'
import { paintingClasses } from './paintingPrimitives'

const PaintingPage: FC = () => {
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId } = usePaintingInitialProvider(providerOptions)

  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() => createDefaultPainting(initialProviderId))

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }) as PaintingData)
  }, [])

  const history = usePaintingHistory()

  usePaintingInitialSelection({ currentPainting, historyItems: history.items, initialProviderId, setCurrentPainting })

  // Rehydrate the running spinner after a page switch: the cache mirror of
  // generation state survives unmount, so re-mounting picks it back up.
  const [cachedGeneration] = useCache(`painting.generation.${currentPainting.id}`)
  const liveGenerationState = useMemo(() => cacheToPaintingGenerationState(cachedGeneration), [cachedGeneration])

  const currentProviderId = currentPainting.providerId || initialProviderId

  const modelCatalog = usePaintingModelCatalog({
    providerOptions,
    painting: currentPainting
  })

  // Default model is a view/fallback concern, not stored state: a model-less painting
  // (fresh draft, `+`-created) shows and generates with the first available model
  // until the user picks or generation persists one. No mount effect writes it, so it
  // can't race the history bootstrap and disarm usePaintingInitialSelection.
  const composerPainting = useMemo<PaintingData>(() => {
    if (currentPainting.model) return currentPainting
    const fallback = modelCatalog.currentModelOptions[0]?.value
    return fallback ? { ...currentPainting, model: String(fallback) } : currentPainting
  }, [currentPainting, modelCatalog.currentModelOptions])

  const {
    generating: liveGenerating,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    painting: composerPainting,
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

  const list = usePaintingList({
    painting: currentPainting,
    setCurrentPainting,
    currentProviderId,
    modelOptions: modelCatalog.currentModelOptions,
    historyItems: history.items,
    cancelGeneration
  })

  const onCancel = useCallback(() => cancelGeneration(currentPainting.id), [cancelGeneration, currentPainting.id])
  const saveCurrentRef = useRef(list.saveCurrent)
  saveCurrentRef.current = list.saveCurrent

  useEffect(() => {
    return () => {
      void saveCurrentRef.current()
    }
  }, [])

  return (
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className="flex h-full flex-1 flex-col">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <PaintingStrip
                selectedPaintingId={currentPainting.id}
                runningPaintingId={generating ? currentPainting.id : undefined}
                items={history.items}
                hasMore={history.hasMore}
                loadMore={history.loadMore}
                onDeletePainting={list.remove}
                onSelectPainting={list.select}
                onAddPainting={list.add}
              />

              <div className={paintingClasses.centerPane}>
                <div className={paintingClasses.centerStage}>
                  <Artboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />
                </div>
                <div className={paintingClasses.promptDock}>
                  <div className={paintingClasses.promptDockInner}>
                    <QuickPanelProvider>
                      <PaintingComposer
                        painting={composerPainting}
                        generating={generating}
                        onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
                        onInputFilesChange={(inputFiles) => patchPainting({ inputFiles } as Partial<PaintingData>)}
                        onGenerate={submit}
                        onCancel={onCancel}
                        onModelSelect={switchModel}
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
                    </QuickPanelProvider>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
