import { useCache } from '@data/hooks/useCache'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Artboard from './components/Artboard'
import PaintingComposer from './components/PaintingComposer'
import PaintingStrip from './components/PaintingStrip'
import PaintingTemplateShowcase from './components/PaintingTemplateShowcase'
import { usePaintingDraftDefaults } from './hooks/usePaintingDraftDefaults'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingHistory } from './hooks/usePaintingHistory'
import { usePaintingInitialDraft } from './hooks/usePaintingInitialDraft'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import { usePaintingResultSync } from './hooks/usePaintingResultSync'
import { usePaintingTemplateCatalog } from './hooks/usePaintingTemplateCatalog'
import { createDefaultPainting } from './model/paintingPipeline'
import type { PaintingData } from './model/types/paintingData'
import { cacheToPaintingGenerationState } from './model/utils/paintingGenerationParams'
import { paintingClasses } from './paintingPrimitives'

interface PaintingTemplateShowcaseStageProps {
  painting: PaintingData
  onSelect: (prompt: string) => void
}

const PaintingTemplateShowcaseStage: FC<PaintingTemplateShowcaseStageProps> = ({ painting, onSelect }) => {
  const { t } = useTranslation()
  const { templates: promptPresets } = usePaintingTemplateCatalog()

  return (
    <section
      data-testid="painting-template-stage"
      className="absolute inset-0 z-0 mx-auto flex min-h-0 w-full max-w-5xl items-center justify-center overflow-hidden px-3 pt-3 pb-36 [container-type:size]">
      <div className="flex h-full max-h-80 min-h-0 w-full flex-col items-center">
        <h1 className="max-w-xl shrink-0 text-center font-bold tracking-tight [font-size:clamp(var(--font-size-heading-sm),4cqw,var(--font-size-heading-md))] [line-height:1.1]">
          {t('paintings.showcase.title')}
        </h1>

        <div className="mt-[clamp(8px,5cqh,30px)] flex min-h-0 w-full flex-1 flex-col items-center">
          {promptPresets.length > 0 ? (
            <PaintingTemplateShowcase
              paintingId={painting.id}
              prompt={painting.prompt ?? ''}
              templates={promptPresets}
              onSelect={onSelect}
            />
          ) : (
            <Artboard painting={painting} isLoading={false} />
          )}

          <p className="mt-[clamp(4px,2cqh,10px)] max-w-lg shrink-0 px-4 pb-1 text-center text-muted-foreground text-xs leading-5">
            {t('paintings.showcase.caption')}
          </p>
        </div>
      </div>
    </section>
  )
}

const PaintingPage: FC = () => {
  const providerOptions = usePaintingProviderOptions()
  const draftDefaults = usePaintingDraftDefaults(providerOptions)

  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() => createDefaultPainting(draftDefaults))

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }) as PaintingData)
  }, [])

  const history = usePaintingHistory()

  usePaintingInitialDraft({
    currentPainting,
    draftDefaults,
    setCurrentPainting
  })

  // Backfill a background generation's output files when they only reached
  // refreshed history (its completion couldn't update the no-longer-visible
  // draft), so the Artboard reveal doesn't strand on a permanent skeleton.
  usePaintingResultSync({ currentPainting, historyItems: history.items, setCurrentPainting })

  // Rehydrate the running spinner after a page switch: the cache mirror of
  // generation state survives unmount, so re-mounting picks it back up.
  const [cachedGeneration] = useCache(`painting.generation.${currentPainting.id}`)
  const liveGenerationState = useMemo(() => cacheToPaintingGenerationState(cachedGeneration), [cachedGeneration])

  const modelCatalog = usePaintingModelCatalog({
    providerOptions,
    painting: currentPainting
  })

  // Historical model-less rows and drafts without a valid configured default
  // still need a usable view fallback. New drafts receive the configured model
  // as stored in-memory state before reaching this path.
  const composerPainting = useMemo<PaintingData>(() => {
    if (currentPainting.model) return currentPainting
    const fallback = modelCatalog.currentModelOptions.find((option) => option.isEnabled !== false)?.value
    return fallback ? { ...currentPainting, model: String(fallback) } : currentPainting
  }, [currentPainting, modelCatalog.currentModelOptions])

  const {
    generating: liveGenerating,
    submitting,
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
  const showTemplateShowcase =
    !currentPainting.persistedAt &&
    currentPainting.files.length === 0 &&
    !submitting &&
    !generating &&
    !currentPainting.generationStatus &&
    !liveGenerationState.generationStatus

  const switchModel = usePaintingModelSwitch({
    painting: currentPainting,
    onPaintingChange: patchPainting,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const list = usePaintingList({
    painting: currentPainting,
    setCurrentPainting,
    draftDefaults,
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
    <div data-ui="paintings.view" className={paintingClasses.page}>
      <div className={paintingClasses.content}>
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
                  {!showTemplateShowcase && <Artboard painting={composerPainting} isLoading={generating} />}
                </div>
                {showTemplateShowcase && (
                  <PaintingTemplateShowcaseStage
                    painting={composerPainting}
                    onSelect={(prompt) => patchPainting({ prompt })}
                  />
                )}
                <div className={paintingClasses.promptDock}>
                  <div className="mx-auto w-full max-w-5xl">
                    <QuickPanelProvider>
                      <PaintingComposer
                        painting={composerPainting}
                        generating={generating}
                        submitting={submitting}
                        onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
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
