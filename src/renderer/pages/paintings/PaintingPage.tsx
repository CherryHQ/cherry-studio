import { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCache } from '@data/hooks/useCache'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { usePaintings } from '@renderer/hooks/usePaintings'

import Artboard from './components/Artboard'
import PaintingComposer from './components/PaintingComposer'
import PaintingSteps from './components/PaintingSteps'
import PaintingStrip from './components/PaintingStrip'
import PaintingTemplateShowcase from './components/PaintingTemplateShowcase'
import { presentPaintingGenerateError } from './errors/paintingGenerateError'
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

const PaintingPage: FC = () => {
  const { t } = useTranslation()
  const { templates: promptPresets } = usePaintingTemplateCatalog()
  const providerOptions = usePaintingProviderOptions()
  const draftDefaults = usePaintingDraftDefaults(providerOptions)

  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() => createDefaultPainting(draftDefaults))

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }))
  }, [])

  const history = usePaintingHistory()
  const projectId = currentPainting.projectId ?? currentPainting.id
  const [locateSource, setLocateSource] = useState<{ projectId: string; stepId: string; sequence: number }>()
  const steps = usePaintingHistory(currentPainting.persistedAt ? projectId : '__draft')
  const { selectPainting } = usePaintings()
  const selectStep = useCallback(
    async (item: PaintingData, fileId?: string) => {
      try {
        await selectPainting(item.projectId ?? item.id, item.id, fileId)
        setCurrentPainting({ ...item, selectedFileId: fileId ?? item.files[0]?.id })
      } catch (error) {
        presentPaintingGenerateError(error)
      }
    },
    [selectPainting]
  )
  const selectImage = useCallback(
    (fileId: string) => {
      setCurrentPainting((current) => ({ ...current, selectedFileId: fileId }))
      void selectPainting(projectId, currentPainting.id, fileId).catch(presentPaintingGenerateError)
    },
    [selectPainting, projectId, currentPainting.id]
  )

  usePaintingInitialDraft({
    currentPainting,
    draftDefaults,
    setCurrentPainting
  })

  // Backfill a background generation's output files when they only reached
  // refreshed history (its completion couldn't update the no-longer-visible
  // draft), so the Artboard reveal doesn't strand on a permanent skeleton.
  usePaintingResultSync({ currentPainting, historyItems: steps.items, setCurrentPainting })

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
    if (currentPainting.model)
      return {
        ...currentPainting,
        mode: currentPainting.files.length || currentPainting.sourceFileId ? 'edit' : 'generate'
      }
    const fallback = modelCatalog.currentModelOptions.find((option) => option.isEnabled !== false)?.value
    return fallback ? { ...currentPainting, model: String(fallback) } : currentPainting
  }, [currentPainting, modelCatalog.currentModelOptions])

  const {
    generating: liveGenerating,
    submitting,
    preparing,
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

  // Preparation may still replace/write the record. Once generation is running,
  // it only persists output files and New can save editable fields independently.
  const busy = list.saving || preparing

  const onCancel = useCallback(() => cancelGeneration(currentPainting.id), [cancelGeneration, currentPainting.id])
  return (
    <div data-ui="paintings.view" className={paintingClasses.page}>
      <div className={paintingClasses.content} inert={busy} aria-busy={busy}>
        <div className="flex h-full flex-1 flex-col">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <PaintingStrip
                selectedPaintingId={projectId}
                items={history.items}
                hasMore={history.hasMore}
                loadMore={history.loadMore}
                onDeletePainting={list.remove}
                onSelectPainting={list.select}
                onAddPainting={list.add}
                adding={busy}
              />

              <div className={paintingClasses.centerPane}>
                <div className={paintingClasses.centerStage}>
                  {!showTemplateShowcase && (
                    <Artboard painting={composerPainting} isLoading={generating} onSelectImage={selectImage} />
                  )}
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
                <div className={paintingClasses.promptDock}>
                  <div className="@container/painting-composer mx-auto w-full max-w-5xl">
                    <QuickPanelProvider>
                      <PaintingComposer
                        painting={composerPainting}
                        sourcePainting={
                          currentPainting.files.length
                            ? currentPainting
                            : steps.items.find((step) => step.id === currentPainting.parentId)
                        }
                        onLocateSource={() => {
                          const stepId = currentPainting.files.length ? currentPainting.id : currentPainting.parentId
                          if (stepId)
                            setLocateSource((current) => ({
                              projectId,
                              stepId,
                              sequence: (current?.sequence ?? 0) + 1
                            }))
                        }}
                        generating={generating}
                        submitting={submitting}
                        onPromptChange={(prompt) => patchPainting({ prompt })}
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
              {currentPainting.persistedAt && (
                <PaintingSteps
                  items={steps.items}
                  locateRequest={locateSource?.projectId === projectId ? locateSource : undefined}
                  selected={currentPainting}
                  hasMore={steps.hasMore}
                  loadMore={steps.loadMore}
                  onSelect={selectStep}
                  onCancel={cancelGeneration}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
