import { Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCreations } from '@renderer/hooks/useCreations'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { VideoGenerationMode } from '@shared/data/types/model'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PaintingFieldRenderer } from '../../paintings/form/PaintingFieldRenderer'
import { videoGenerationToFields } from '../../paintings/form/videoGenerationToFields'
import CreationGallery from '../CreationGallery'
import CreationModelSelector, {
  type CreationModelKindSelection,
  type CreationModelSelection
} from '../CreationModelSelector'
import { creationClasses } from '../creationPrimitives'
import CreationSectionTitle from '../CreationSectionTitle'
import CreationWorkspace from '../CreationWorkspace'
import type { CreationData } from '../types'
import { useCreationHistory } from '../useCreationHistory'
import { generateVideoRequest } from './generateVideo'
import { useVideoGenerationSupport } from './useVideoGenerationSupport'
import VideoArtboard from './VideoArtboard'
import VideoMediaInput from './VideoMediaInput'

const logger = loggerService.withContext('creation/VideoCreationMode')

const VIDEO_MODE_LABEL_KEYS: Record<VideoGenerationMode, string> = {
  t2v: 'paintings.video.mode_options.t2v',
  i2v: 'paintings.video.mode_options.i2v',
  keyframe: 'paintings.video.mode_options.keyframe',
  reference: 'paintings.video.mode_options.reference',
  extend: 'paintings.video.mode_options.extend',
  edit: 'paintings.video.mode_options.edit',
  multishot: 'paintings.video.mode_options.multishot'
}

interface VideoCreationModeProps {
  initialSelection?: CreationModelSelection
  initialCreationItem?: CreationData
  onModelKindSelect?: (selection: CreationModelKindSelection) => void
  onCreationKindSelect?: (item: CreationData) => void
}

/**
 * Video creation mode. Drives everything off
 * `useVideoGenerationSupport`: mode tabs + media pickers + scalar fields come
 * from the registry's `videoGeneration` block, and generation goes through
 * `generateVideoRequest` → `window.api.ai.generateVideo` (job system).
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
  const [generating, setGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const support = useVideoGenerationSupport(providerId, modelId)
  const modes = useMemo(() => Object.keys(support?.modes ?? {}) as VideoGenerationMode[], [support])
  const fields = useMemo(() => videoGenerationToFields(support, { mode }), [support, mode])
  const mediaInputs = support?.modes?.[mode]?.mediaInputs

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

  const canGenerate = Boolean(providerId && modelId && (prompt.trim() || firstFrame) && !generating)

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
        window.toast.error(t('paintings.video.generate_failed'))
      }
    } finally {
      setGenerating(false)
      abortRef.current = null
    }
  }, [providerId, modelId, prompt, firstFrame, lastFrame, params, generating, createCreation, t])

  return (
    <CreationWorkspace
      modelSelector={
        <CreationModelSelector
          className={creationClasses.panelModelSelectorTrigger}
          providerId={providerId}
          modelId={modelId}
          onSelect={onSelectCreationModel}
        />
      }
      settings={
        <>
          {modes.length > 1 && (
            <Tabs value={mode} onValueChange={(value) => setMode(value as VideoGenerationMode)}>
              <TabsList className={creationClasses.promptModeTabsList}>
                {modes.map((m) => (
                  <TabsTrigger key={m} value={m} className={creationClasses.promptModeTabsTrigger}>
                    {t(VIDEO_MODE_LABEL_KEYS[m], m)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {(mediaInputs?.firstFrame || mediaInputs?.lastFrame) && (
            <div className="flex flex-wrap gap-3">
              {mediaInputs?.firstFrame && (
                <VideoMediaInput
                  label={t('paintings.video.first_frame')}
                  value={firstFrame}
                  disabled={generating}
                  onChange={setFirstFrame}
                />
              )}
              {mediaInputs?.lastFrame && (
                <VideoMediaInput
                  label={t('paintings.video.last_frame')}
                  value={lastFrame}
                  disabled={generating}
                  onChange={setLastFrame}
                />
              )}
            </div>
          )}

          {fields.map((item) => (
            <div key={item.key} className="flex flex-col gap-1.5">
              {item.title && <CreationSectionTitle>{t(item.title)}</CreationSectionTitle>}
              <PaintingFieldRenderer
                item={item}
                painting={params}
                onChange={onParamsChange}
                onGenerateRandomSeed={(key) => onParamsChange({ [key]: String(Math.floor(Math.random() * 1_000_000)) })}
              />
            </div>
          ))}
        </>
      }
      artboard={<VideoArtboard files={files} isLoading={generating} onCancel={onCancel} />}
      promptBar={
        <div className="flex w-full min-w-0 shrink-0 flex-col rounded-[1.25rem] border border-border bg-background">
          <Textarea.Input
            disabled={generating}
            value={prompt}
            spellCheck={false}
            className="min-h-19 flex-1 resize-none border-0 bg-transparent px-4 pt-3 pb-1.5 text-foreground/85 text-sm shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0"
            placeholder={t('paintings.prompt_placeholder')}
            onValueChange={setPrompt}
          />
          <div className="flex min-h-11 items-center justify-end px-3.5 pt-2 pb-3">
            <SendMessageButton sendMessage={onGenerate} disabled={!canGenerate} />
          </div>
        </div>
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
