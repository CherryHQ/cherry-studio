import { useCache } from '@data/hooks/useCache'
import Scrollbar from '@renderer/components/Scrollbar'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Artboard from './components/Artboard'
import PaintingModelSelector from './components/PaintingModelSelector'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingSettings from './components/PaintingSettings'
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
              <div className={paintingClasses.panel}>
                <div className={paintingClasses.panelModelSelector}>
                  <PaintingModelSelector
                    className={paintingClasses.panelModelSelectorTrigger}
                    painting={currentPainting}
                    onSelect={switchModel}
                  />
                </div>
                <div className={paintingClasses.panelBody}>
                  <Scrollbar className={paintingClasses.panelScroll}>
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
                  </Scrollbar>
                </div>
              </div>

              <div className={paintingClasses.centerPane}>
                <div className={paintingClasses.centerStage}>
                  <Artboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />
                </div>
                <div className={paintingClasses.promptDock}>
                  <PaintingPromptBar
                    painting={currentPainting}
                    generating={generating}
                    onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
                    onInputFilesChange={(inputFiles) => patchPainting({ inputFiles } as Partial<PaintingData>)}
                    onGenerate={submit}
                  />
                </div>
              </div>

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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
