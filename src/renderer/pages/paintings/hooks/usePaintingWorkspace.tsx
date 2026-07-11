import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import FileManager from '@renderer/services/FileManager'
import { download } from '@renderer/utils/download'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasPoint } from '../components/canvas/CanvasToolbar'
import PaintingComposer from '../components/PaintingComposer'
import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import {
  appendComposerInputFiles,
  cardToDerivedDraft,
  cardToRetryDraft,
  type ComposerDraft,
  createDraft
} from '../model/composerDraft'
import { resolvePaintingFileEntries } from '../model/mappers/recordToPaintingData'
import type { PaintingData } from '../model/types/paintingData'
import { usePaintingGenerationSubmit } from './usePaintingGenerationSubmit'
import { usePaintingHistory } from './usePaintingHistory'
import { usePaintingInitialProvider } from './usePaintingInitialProvider'
import { usePaintingInitialSelection } from './usePaintingInitialSelection'
import { usePaintingList } from './usePaintingList'
import { usePaintingModelCatalog } from './usePaintingModelCatalog'
import { usePaintingModelSwitch } from './usePaintingModelSwitch'
import { usePaintingProviderOptions } from './usePaintingProviderOptions'

// Browser File → data URL for `createInternalEntry({ source: 'base64' })`.
function readFileAsDataUrl(file: File): Promise<`data:${string};base64,${string}`> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as `data:${string};base64,${string}`)
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * The paintings page's shared workspace: composer authoring state, the
 * generation pipeline, history data, and every card-level action — all
 * view-agnostic. Both the canvas and the message-list view consume this; each
 * only adds its own layout + view-specific interaction (drag / hull for the
 * canvas, which read `selectedId` / `onMove` / `onResize` / `onUngroup` and the
 * board / upload actions the list ignores).
 */
export function usePaintingWorkspace() {
  const { t } = useTranslation()
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId } = usePaintingInitialProvider(providerOptions)

  // The composer's own authoring state — never a painting record. Generating
  // produces a card; the draft keeps its settings for the next one.
  const [draft, setDraft] = useState<ComposerDraft>(() => createDraft(initialProviderId))
  const [selectedId, setSelectedId] = useState<string>()
  // Set by `onRegenerate` to fire a generation on the next render — once the new
  // draft has committed, so `submit` (and the provider runtime) see it.
  const [pendingRegenerate, setPendingRegenerate] = useState(false)

  const patchDraft = useCallback((updates: Partial<ComposerDraft>) => {
    setDraft((current) => ({ ...current, ...updates }))
  }, [])

  const history = usePaintingHistory()

  usePaintingInitialSelection({ draft, initialProviderId, setDraft })

  const modelCatalog = usePaintingModelCatalog({ providerOptions, painting: draft })

  const {
    inflightCards,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    draft,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  const generating = inflightCards.length > 0

  const switchModel = usePaintingModelSwitch({
    draft,
    onDraftChange: patchDraft,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const list = usePaintingList({ cancelGeneration })

  const onCancel = useCallback(() => {
    const primary = inflightCards[0]
    if (primary) cancelGeneration(primary.id)
  }, [cancelGeneration, inflightCards])

  // Generating forks (or, for a retry, fills) a card. Afterward the composer
  // keeps its model / params / prompt / input images so the next generation
  // reuses them — only the retry target is dropped so the next send forks a new
  // card instead of refilling the same one.
  const onGenerate = useCallback(async () => {
    await submit()
    patchDraft({ targetCardId: undefined })
  }, [submit, patchDraft])

  // Drain a pending regenerate: `onRegenerate` swapped the draft and set the flag,
  // so by now `onGenerate` (and the provider runtime) read the source's recipe.
  useEffect(() => {
    if (!pendingRegenerate) return
    setPendingRegenerate(false)
    void onGenerate()
  }, [pendingRegenerate, onGenerate])

  // Select = highlight only; the composer keeps its own draft untouched. The id
  // may be a painting/group id or a group hull id (`group:${groupId}`).
  const onSelect = useCallback((nodeId: string) => setSelectedId(nodeId), [])
  const onDeselect = useCallback(() => setSelectedId(undefined), [])

  // Edit: load the card's image into the composer under edit mode. This explicitly
  // replaces the draft (the user chose to build on this image) — unlike a plain
  // select, which leaves the draft alone.
  const onEdit = useCallback(async (source: PaintingData) => {
    const inputFiles = await resolvePaintingFileEntries(source.files.map((file) => file.id))
    setDraft(cardToDerivedDraft(source, 'edit', inputFiles))
  }, [])

  // Regenerate: one click forks a new card from the card's recipe (same prompt /
  // model / params, no source image) and fires the generation immediately — the
  // `pendingRegenerate` flag defers the submit until the new draft has committed.
  const onRegenerate = useCallback((source: PaintingData) => {
    setDraft(cardToDerivedDraft(source, 'generate', []))
    setPendingRegenerate(true)
  }, [])

  // Add to chat: drop the card's image into the *current* composer as an input,
  // keeping the prompt / model / params the user is composing.
  const onAddToChat = useCallback(async (source: PaintingData) => {
    const additions = await resolvePaintingFileEntries(source.files.map((file) => file.id))
    setDraft((current) => appendComposerInputFiles(current, additions))
  }, [])

  // Retry a failed/canceled card: load its recipe into the composer (targetCardId
  // set → the next send updates that same card in place).
  const onRetry = useCallback((card: PaintingData) => {
    setSelectedId(card.id)
    setDraft(cardToRetryDraft(card))
  }, [])

  // Add an empty board, then point the composer at it (targetCardId) so the next
  // generation fills this card in place instead of forking a new one.
  const onAddBoard = useCallback(
    async (position: CanvasPoint) => {
      const id = await list.createBoard(draft.providerId, position)
      if (!id) return
      setSelectedId(id)
      patchDraft({ targetCardId: id })
    },
    [list, draft.providerId, patchDraft]
  )

  // Import an image file as a source card (selected so it's ready to derive from).
  const onUploadAsset = useCallback(
    async (file: File, position: CanvasPoint) => {
      try {
        const data = await readFileAsDataUrl(file)
        const entry = await window.api.file.createInternalEntry({ source: 'base64', data })
        const id = await list.createAsset(draft.providerId, entry.id, position)
        if (id) setSelectedId(id)
      } catch (error) {
        presentPaintingGenerateError(error)
      }
    },
    [list, draft.providerId]
  )

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

  const onResize = useCallback((id: string, width: number) => void list.resize(id, width), [list])
  const onUngroup = useCallback((id: string) => void list.ungroup(id), [list])

  // Built once, placed by whichever view is active (canvas floats it, list docks it).
  const composer: ReactNode = (
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
  )

  return {
    // data
    items: history.items,
    hasMore: history.hasMore,
    loadMore: history.loadMore,
    isLoading: history.isLoading,
    inflightCards,
    generating,
    // the wired composer element
    composer,
    // shared, view-agnostic card actions
    onEdit,
    onRegenerate,
    onAddToChat,
    onDelete,
    onDownload,
    onCopyPrompt,
    onRetry,
    // canvas-only (the list view ignores these)
    selectedId,
    onSelect,
    onDeselect,
    onMove: list.move,
    onResize,
    onUngroup,
    onAddBoard,
    onUploadAsset
  }
}
