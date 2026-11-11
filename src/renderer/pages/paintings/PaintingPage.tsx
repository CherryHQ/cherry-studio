import { ChevronDown, ChevronUp } from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCache } from '@data/hooks/useCache'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'

import Artboard from './components/Artboard'
import PaintingBatchGrid from './components/PaintingBatchGrid'
import PaintingComposer from './components/PaintingComposer'
import PaintingStrip from './components/PaintingStrip'
import PaintingTemplateShowcase from './components/PaintingTemplateShowcase'
import { usePaintingBatch } from './hooks/usePaintingBatch'
import { usePaintingDraftDefaults } from './hooks/usePaintingDraftDefaults'
import { type MaterializeInputs, usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingHistory } from './hooks/usePaintingHistory'
import { usePaintingInitialDraft } from './hooks/usePaintingInitialDraft'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import { usePaintingResultSync } from './hooks/usePaintingResultSync'
import { usePaintingTemplateCatalog } from './hooks/usePaintingTemplateCatalog'
import { isSamePaintingTarget, type PaintingTarget } from './model/paintingBatch'
import { createDefaultPainting } from './model/paintingPipeline'
import type { PaintingData } from './model/types/paintingData'
import { cacheToPaintingGenerationState } from './model/utils/paintingGenerationParams'
import { paintingClasses } from './paintingPrimitives'

const NO_EXTRA_TARGETS: PaintingTarget[] = []

const PaintingPage: FC = () => {
  const { t } = useTranslation()
  const { templates: promptPresets } = usePaintingTemplateCatalog()
  const providerOptions = usePaintingProviderOptions()
  const draftDefaults = usePaintingDraftDefaults(providerOptions)

  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() => createDefaultPainting(draftDefaults))
  // After generate, collapse the prompt dock so the artboard keeps the space
  // long prompts used to steal (#20739). Blank drafts stay expanded for typing.
  const [promptDockCollapsed, setPromptDockCollapsed] = useState(false)

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }))
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

  // Restored receipts need cached terminal states to stop the artboard waiting.
  // Model-less receipts and drafts still use the first enabled catalog model.
  const composerPainting = useMemo<PaintingData>(() => {
    const painting = cachedGeneration ? { ...currentPainting, ...liveGenerationState } : currentPainting
    if (painting.model) return painting
    const fallback = modelCatalog.currentModelOptions.find((option) => option.isEnabled !== false)?.value
    return fallback ? { ...painting, model: String(fallback) } : painting
  }, [cachedGeneration, currentPainting, liveGenerationState, modelCatalog.currentModelOptions])

  const {
    generating,
    submitting,
    preparing,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    painting: composerPainting,
    onPaintingChange: setCurrentPainting,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  const batch = usePaintingBatch()
  const { running: batchRunning, dismiss: dismissBatch, submit: submitBatch } = batch
  // Extra models live with the draft they were picked for, so a different painting starts from its own model alone.
  const [extraTargetsState, setExtraTargetsState] = useState<{ paintingId: string; targets: PaintingTarget[] }>()
  const extraTargets =
    extraTargetsState?.paintingId === currentPainting.id ? extraTargetsState.targets : NO_EXTRA_TARGETS
  const primaryTarget = useMemo<PaintingTarget | undefined>(
    () =>
      composerPainting.providerId && composerPainting.model
        ? { providerId: composerPainting.providerId, modelId: composerPainting.model }
        : undefined,
    [composerPainting.providerId, composerPainting.model]
  )
  const targets = useMemo(
    () =>
      primaryTarget
        ? [primaryTarget, ...extraTargets.filter((target) => !isSamePaintingTarget(target, primaryTarget))]
        : [],
    [extraTargets, primaryTarget]
  )

  // Leaving the painting drops its batch view; the batch's rows stay in history.
  useEffect(() => {
    dismissBatch()
  }, [currentPainting.id, dismissBatch])

  const showTemplateShowcase =
    !currentPainting.persistedAt &&
    currentPainting.files.length === 0 &&
    !submitting &&
    !generating &&
    !currentPainting.generationStatus &&
    !liveGenerationState.generationStatus &&
    batch.columns.length === 0

  const switchModel = usePaintingModelSwitch({
    painting: currentPainting,
    onPaintingChange: patchPainting,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const selectTargets = useCallback(
    (selected: PaintingTarget[]) => {
      if (selected.length === 0) return
      const nextPrimary = (primaryTarget && selected.find((t) => isSamePaintingTarget(t, primaryTarget))) ?? selected[0]
      if (!primaryTarget || !isSamePaintingTarget(nextPrimary, primaryTarget)) void switchModel(nextPrimary)
      setExtraTargetsState({
        paintingId: currentPainting.id,
        targets: selected.filter((target) => !isSamePaintingTarget(target, nextPrimary))
      })
    },
    [currentPainting.id, primaryTarget, switchModel]
  )

  const generateFromComposer = useCallback(
    (materialize: MaterializeInputs) => {
      if (primaryTarget && targets.length > 1) {
        return submitBatch({
          targets,
          primary: primaryTarget,
          prompt: composerPainting.prompt,
          mode: composerPainting.mode,
          draftParams: composerPainting.params ?? {},
          materialize
        })
      }
      dismissBatch()
      return submit(materialize)
    },
    [
      composerPainting.mode,
      composerPainting.params,
      composerPainting.prompt,
      dismissBatch,
      primaryTarget,
      submit,
      submitBatch,
      targets
    ]
  )

  const list = usePaintingList({
    painting: currentPainting,
    setCurrentPainting,
    draftDefaults,
    historyItems: history.items,
    cancelGeneration
  })

  // Preparation may still replace/write the record. Once generation is running,
  // it only persists output files and New can save editable fields independently.
  const busy = list.saving || preparing

  const onCancel = useCallback(
    () => (batchRunning ? batch.cancelAll() : cancelGeneration(currentPainting.id)),
    [batch, batchRunning, cancelGeneration, currentPainting.id]
  )
  const saveCurrentRef = useRef(list.saveCurrent)
  saveCurrentRef.current = list.saveCurrent
  const hasGeneratedImages = composerPainting.files.length > 0
  const canCollapsePromptDock = hasGeneratedImages && !showTemplateShowcase

  useEffect(() => {
    return () => {
      void saveCurrentRef.current()
    }
  }, [])

  // Collapse when a painting gains output files (fresh generate or select with
  // images). Expand again while generating so Cancel stays reachable, and for
  // blank drafts that still need the full composer.
  useEffect(() => {
    if (generating || showTemplateShowcase || !hasGeneratedImages) {
      setPromptDockCollapsed(false)
      return
    }
    setPromptDockCollapsed(true)
  }, [composerPainting.id, generating, hasGeneratedImages, showTemplateShowcase])

  return (
    <div data-ui="paintings.view" className={paintingClasses.page}>
      <div className={paintingClasses.content} inert={busy} aria-busy={busy}>
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
                adding={busy}
              />

              <div className={paintingClasses.centerPane} data-composer-stage="">
                <div className={paintingClasses.centerStage}>
                  {!showTemplateShowcase &&
                    (batch.columns.length > 0 ? (
                      <PaintingBatchGrid
                        columns={batch.columns}
                        onRegenerate={batch.regenerate}
                        onCancel={batch.cancel}
                        onRemove={batch.remove}
                      />
                    ) : (
                      <Artboard painting={composerPainting} isLoading={generating} />
                    ))}
                </div>
                {showTemplateShowcase && (
                  <section
                    data-testid="painting-template-stage"
                    className="[container-type:size] absolute inset-0 z-0 mx-auto flex min-h-0 w-full max-w-5xl items-center justify-center overflow-hidden px-3 pt-3 pb-36">
                    <div className="flex h-full max-h-80 min-h-0 w-full flex-col items-center">
                      <h1 className="max-w-xl shrink-0 text-center [font-size:clamp(var(--font-size-heading-sm),4cqw,var(--font-size-heading-md))] [line-height:1.1] font-bold tracking-tight">
                        {t('paintings.showcase.title')}
                      </h1>

                      <div className="mt-[clamp(8px,5cqh,30px)] flex min-h-0 w-full flex-1 flex-col items-center">
                        {promptPresets.length > 0 ? (
                          <PaintingTemplateShowcase
                            paintingId={composerPainting.id}
                            prompt={composerPainting.prompt}
                            templates={promptPresets}
                            onSelect={(prompt) => patchPainting({ prompt })}
                          />
                        ) : (
                          <Artboard painting={composerPainting} isLoading={false} />
                        )}

                        <p className="mt-[clamp(4px,2cqh,10px)] max-w-lg shrink-0 px-4 pb-1 text-center text-xs leading-5 text-muted-foreground">
                          {t('paintings.showcase.caption')}
                        </p>
                      </div>
                    </div>
                  </section>
                )}
                {canCollapsePromptDock && promptDockCollapsed ? (
                  <div className={paintingClasses.promptDockCollapsed} data-testid="painting-prompt-dock-collapsed">
                    <button
                      type="button"
                      className={paintingClasses.promptDockToggle}
                      aria-expanded={false}
                      aria-label={t('paintings.prompt_dock.expand')}
                      onClick={() => setPromptDockCollapsed(false)}>
                      <ChevronUp className="size-3.5" aria-hidden />
                      {t('paintings.prompt_dock.expand')}
                    </button>
                  </div>
                ) : (
                  <div
                    className={paintingClasses.promptDock}
                    data-composer-dock-surface=""
                    data-testid="painting-prompt-dock">
                    {canCollapsePromptDock && (
                      <div className="mx-auto mb-1 flex w-full max-w-5xl justify-center">
                        <button
                          type="button"
                          className={paintingClasses.promptDockToggle}
                          aria-expanded={true}
                          aria-label={t('paintings.prompt_dock.minimize')}
                          onClick={() => setPromptDockCollapsed(true)}>
                          <ChevronDown className="size-3.5" aria-hidden />
                          {t('paintings.prompt_dock.minimize')}
                        </button>
                      </div>
                    )}
                    <div className="mx-auto w-full max-w-5xl">
                      <QuickPanelProvider>
                        <PaintingComposer
                          painting={composerPainting}
                          generating={generating || batchRunning}
                          submitting={submitting || batch.preparing}
                          onPromptChange={(prompt) => patchPainting({ prompt })}
                          onGenerate={generateFromComposer}
                          onCancel={onCancel}
                          targets={targets}
                          onTargetsSelect={selectTargets}
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
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
