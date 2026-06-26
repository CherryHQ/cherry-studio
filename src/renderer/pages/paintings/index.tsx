import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import FileManager from '@renderer/services/FileManager'
import { download } from '@renderer/utils/download'
import { type FC, lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasActions } from './components/canvas/canvasActions'
import type { CanvasOp } from './components/canvas/canvasOps'
import PaintingComposer from './components/PaintingComposer'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingHistory } from './hooks/usePaintingHistory'
import { usePaintingInitialProvider } from './hooks/usePaintingInitialProvider'
import { usePaintingInitialSelection } from './hooks/usePaintingInitialSelection'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import { cardToDerivedDraft, cardToRetryDraft, type ComposerDraft, createDraft } from './model/composerDraft'
import { resolvePaintingFileEntries } from './model/mappers/recordToPaintingData'
import type { PaintingData } from './model/types/paintingData'
import { paintingClasses } from './paintingPrimitives'

// React Flow is heavy; keep it (and the whole canvas) out of the main bundle.
const CanvasView = lazy(() => import('./components/canvas/CanvasView'))

const PaintingPage: FC = () => {
  const { t } = useTranslation()
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId } = usePaintingInitialProvider(providerOptions)

  // The composer's own authoring state — never a painting record. Generating
  // produces a card; the draft is then reset. Selecting a card never touches it.
  const [draft, setDraft] = useState<ComposerDraft>(() => createDraft(initialProviderId))
  const [selectedId, setSelectedId] = useState<string>()

  const patchDraft = useCallback((updates: Partial<ComposerDraft>) => {
    setDraft((current) => ({ ...current, ...updates }))
  }, [])

  const history = usePaintingHistory()

  usePaintingInitialSelection({ draft, initialProviderId, setDraft })

  const modelCatalog = usePaintingModelCatalog({ providerOptions, painting: draft })

  const {
    inflightCard,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    draft,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  const generating = inflightCard != null

  const switchModel = usePaintingModelSwitch({
    draft,
    onDraftChange: patchDraft,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const list = usePaintingList({ cancelGeneration })

  const onCancel = useCallback(() => {
    if (inflightCard) cancelGeneration(inflightCard.id)
  }, [cancelGeneration, inflightCard])

  // Generating forks (or, for a retry, fills) a card; afterward the draft returns
  // to a fresh waiting-to-create state on the same provider.
  const onGenerate = useCallback(async () => {
    const { providerId } = draft
    await submit()
    setDraft(createDraft(providerId))
  }, [submit, draft])

  // Select = highlight only; the composer keeps its own draft untouched.
  const onSelectPainting = useCallback((card: PaintingData) => setSelectedId(card.id), [])
  const onDeselect = useCallback(() => setSelectedId(undefined), [])

  // Derive a new generation from a card (node op): feed its outputs in as inputs
  // for image-bearing ops. This explicitly replaces the draft (the user chose to
  // build on this image) — unlike a plain select, which leaves the draft alone.
  const onNodeOp = useCallback(async (op: CanvasOp, source: PaintingData) => {
    const inputFiles = op.usesSourceImage ? await resolvePaintingFileEntries(source.files.map((file) => file.id)) : []
    setDraft(cardToDerivedDraft(source, op.mode, inputFiles))
  }, [])

  // Retry a failed/canceled card: load its recipe into the composer (targetCardId
  // set → the next send updates that same card in place) so the user can keep it
  // (transient → just send) or switch model / edit prompt before resending.
  const onRetryPainting = useCallback((card: PaintingData) => {
    setSelectedId(card.id)
    setDraft(cardToRetryDraft(card))
  }, [])

  const onDownload = useCallback((source: PaintingData) => {
    for (const file of source.files) download(FileManager.getFileUrl(file))
  }, [])

  const onCopyPrompt = useCallback(
    (source: PaintingData) => {
      if (!source.prompt) return
      void navigator.clipboard.writeText(source.prompt)
      window.toast.success(t('paintings.canvas.menu.prompt_copied'))
    },
    [t]
  )

  const onDelete = useCallback(
    (source: PaintingData) => {
      setSelectedId((id) => (id === source.id ? undefined : id))
      void list.remove(source)
    },
    [list]
  )

  const onResizePainting = useCallback((id: string, width: number) => void list.resize(id, width), [list])

  const canvasActions = useMemo<CanvasActions>(
    () => ({ onNodeOp, onDelete, onDownload, onCopyPrompt, onResize: onResizePainting, onRetry: onRetryPainting }),
    [onNodeOp, onDelete, onDownload, onCopyPrompt, onResizePainting, onRetryPainting]
  )

  return (
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className="flex h-full flex-1 flex-col">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <Suspense fallback={null}>
                <CanvasView
                  items={history.items}
                  inflightCard={inflightCard}
                  selectedId={selectedId}
                  actions={canvasActions}
                  onSelectPainting={onSelectPainting}
                  onMovePainting={list.move}
                  onDeselect={onDeselect}
                  composer={
                    <QuickPanelProvider>
                      <PaintingComposer
                        draft={draft}
                        generating={generating}
                        onPromptChange={(prompt) => patchDraft({ prompt })}
                        onInputFilesChange={(inputFiles) => patchDraft({ inputFiles })}
                        onGenerate={onGenerate}
                        onCancel={onCancel}
                        onModelSelect={switchModel}
                        onConfigChange={patchDraft}
                        onGenerateRandomSeed={(key) =>
                          patchDraft({
                            params: { ...draft.params, [key]: String(Math.floor(Math.random() * 1_000_000)) }
                          })
                        }
                      />
                    </QuickPanelProvider>
                  }
                />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
