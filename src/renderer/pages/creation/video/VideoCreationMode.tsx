import { loggerService } from '@logger'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCreations } from '@renderer/hooks/useCreations'
import { toast } from '@renderer/services/toast'
import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import type { VideoGenerationMode } from '@shared/data/types/model'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreationGallery from '../CreationGallery'
import type { CreationModelKindSelection, CreationModelSelection } from '../CreationModelSelector'
import CreationWorkspace from '../CreationWorkspace'
import { videoGenerationToFields } from '../form/videoGenerationToFields'
import { useVideoGenerationSupport } from '../hooks/useVideoGenerationSupport'
import type { CreationData } from '../types'
import { useCreationHistory } from '../useCreationHistory'
import VideoComposer from './components/VideoComposer'
import { generateVideoRequest } from './generateVideo'
import VideoArtboard from './VideoArtboard'

const logger = loggerService.withContext('creation/VideoCreationMode')

interface VideoCreationModeProps {
  initialSelection?: CreationModelSelection
  initialCreationItem?: CreationData
  onModelKindSelect?: (selection: CreationModelKindSelection) => void
  onCreationKindSelect?: (item: CreationData) => void
}

/**
 * Video creation mode. Page structure is identical to the image mode —
 * gallery strip | artboard | bottom composer. Everything model-specific is
 * registry-driven through `useVideoGenerationSupport` and rendered by the
 * composer (mode pills in the toolbar, first/last-frame placeholder slots in
 * the header, scalar params in the popover); generation goes through
 * `generateVideoRequest` → the `ai.generate_video` IpcApi route (job system).
 *
 * Lean by design: generation is awaited in-place (no cross-page spinner
 * rehydration like the image page's cache mirror), and reference-image / video
 * inputs beyond first/last frame are not yet surfaced.
 */
const VideoCreationMode: FC<VideoCreationModeProps> = ({
  initialSelection,
  initialCreationItem,
  onModelKindSelect = () => {},
  onCreationKindSelect = () => {}
}) => {
  const { t } = useTranslation()
  const { createCreation, deleteCreation } = useCreations('video')
  const { items: galleryItems, hasMore, loadMore } = useCreationHistory()

  const [providerId, setProviderId] = useState<string | undefined>(undefined)
  const [modelId, setModelId] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<VideoGenerationMode>('t2v')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [firstFrame, setFirstFrame] = useState<FileEntry | undefined>(undefined)
  const [lastFrame, setLastFrame] = useState<FileEntry | undefined>(undefined)
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [currentId, setCurrentId] = useState<string | undefined>(undefined)
  const [draftEpoch, setDraftEpoch] = useState(0)
  const [generating, setGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const support = useVideoGenerationSupport(providerId, modelId)
  const modes = useMemo(() => Object.keys(support?.modes ?? {}) as VideoGenerationMode[], [support])

  // Keep `mode` valid for the selected model; default to its first declared mode.
  useEffect(() => {
    if (modes.length > 0 && !modes.includes(mode)) setMode(modes[0])
  }, [modes, mode])

  // Reset the form to the current mode's registry defaults when the model or
  // mode changes. User edits within a (model, mode) persist until they switch.
  useEffect(() => {
    const defaults: Record<string, unknown> = {}
    for (const item of videoGenerationToFields(support, { mode })) {
      if (item.key && item.initialValue !== undefined) defaults[item.key] = item.initialValue
    }
    setParams(defaults)
  }, [support, mode])

  const onSelectModel = useCallback((selection: { providerId: string; modelId: string }) => {
    setProviderId(selection.providerId)
    setModelId(selection.modelId)
  }, [])

  const appliedInitialSelectionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialSelection) return
    const key = `${initialSelection.providerId}::${initialSelection.modelId}`
    if (appliedInitialSelectionRef.current === key) return
    appliedInitialSelectionRef.current = key
    onSelectModel(initialSelection)
  }, [initialSelection, onSelectModel])

  const onSelectCreationModel = useCallback(
    (selection: CreationModelKindSelection) => {
      if (selection.kind === 'image') {
        onModelKindSelect(selection)
        return
      }
      onSelectModel(selection)
    },
    [onModelKindSelect, onSelectModel]
  )

  const onParamsChange = useCallback((updates: Record<string, unknown>) => {
    setParams((prev) => ({ ...prev, ...updates }))
  }, [])

  const resetDraft = useCallback(() => {
    setPrompt('')
    setFirstFrame(undefined)
    setLastFrame(undefined)
    setFiles([])
    setCurrentId(undefined)
    // Remount the composer so its seeded text resets to the fresh draft.
    setDraftEpoch((epoch) => epoch + 1)
  }, [])

  const onSelectCreation = useCallback((item: CreationData) => {
    setProviderId(item.providerId)
    setModelId(item.model)
    setPrompt(item.prompt)
    setFiles(item.files)
    setCurrentId(item.id)
    setFirstFrame(undefined)
    setLastFrame(undefined)
  }, [])

  const appliedInitialCreationItemRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialCreationItem || initialCreationItem.kind !== 'video') return
    if (appliedInitialCreationItemRef.current === initialCreationItem.id) return
    appliedInitialCreationItemRef.current = initialCreationItem.id
    onSelectCreation(initialCreationItem)
  }, [initialCreationItem, onSelectCreation])

  const onSelectGalleryItem = useCallback(
    (item: CreationData) => {
      if (item.kind === 'image') {
        onCreationKindSelect(item)
        return
      }
      onSelectCreation(item)
    },
    [onCreationKindSelect, onSelectCreation]
  )

  const onDeleteCreation = useCallback(
    async (id: string) => {
      await deleteCreation(id)
      if (currentId === id) resetDraft()
    },
    [currentId, deleteCreation, resetDraft]
  )

  const onCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const onGenerate = useCallback(async () => {
    if (!providerId || !modelId || generating) return
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    try {
      const out = await generateVideoRequest({
        providerId,
        modelId,
        prompt: prompt.trim(),
        firstFrame,
        lastFrame,
        params,
        support,
        mode,
        signal: controller.signal
      })
      setFiles(out)
      const id = crypto.randomUUID()
      await createCreation({
        id,
        providerId,
        modelId,
        prompt: prompt.trim(),
        files: {
          output: out.map((f) => f.id),
          input: [firstFrame?.id, lastFrame?.id].filter((x): x is string => Boolean(x))
        }
      })
      setCurrentId(id)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        logger.error('video generation failed', error as Error)
        toast.error(t('paintings.video.generate_failed'))
      }
    } finally {
      setGenerating(false)
      abortRef.current = null
    }
  }, [providerId, modelId, prompt, firstFrame, lastFrame, params, support, mode, generating, createCreation, t])

  return (
    <CreationWorkspace
      artboard={<VideoArtboard files={files} isLoading={generating} onCancel={onCancel} />}
      promptBar={
        <QuickPanelProvider>
          <VideoComposer
            composerKey={currentId ?? `draft-${draftEpoch}`}
            providerId={providerId}
            modelId={modelId}
            prompt={prompt}
            generating={generating}
            support={support}
            mode={mode}
            onModeChange={setMode}
            params={params}
            onParamsChange={onParamsChange}
            firstFrame={firstFrame}
            lastFrame={lastFrame}
            onFirstFrameChange={setFirstFrame}
            onLastFrameChange={setLastFrame}
            onPromptChange={setPrompt}
            onGenerate={onGenerate}
            onCancel={onCancel}
            onModelSelect={onSelectCreationModel}
          />
        </QuickPanelProvider>
      }
      historyStrip={
        <CreationGallery
          kind="video"
          selectedCreationId={currentId}
          runningCreationId={generating ? currentId : undefined}
          items={galleryItems}
          hasMore={hasMore}
          loadMore={loadMore}
          onDeleteCreation={(item) => onDeleteCreation(item.id)}
          onSelectCreation={onSelectGalleryItem}
          onAddCreation={resetDraft}
        />
      }
    />
  )
}

export default VideoCreationMode
