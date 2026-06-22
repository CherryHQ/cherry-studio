import { Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { useCreations } from '@renderer/hooks/useCreations'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { VideoGenerationMode } from '@shared/data/types/model'
import { Film, Plus, X } from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import PaintingSectionTitle from '../../paintings/components/PaintingSectionTitle'
import { PaintingFieldRenderer } from '../../paintings/form/PaintingFieldRenderer'
import { videoGenerationToFields } from '../../paintings/form/videoGenerationToFields'
import { usePaintingHistory } from '../../paintings/hooks/usePaintingHistory'
import type { PaintingData } from '../../paintings/model/types/paintingData'
import { paintingClasses } from '../../paintings/paintingPrimitives'
import { generateVideoRequest } from './generateVideo'
import { useVideoGenerationSupport } from './useVideoGenerationSupport'
import VideoArtboard from './VideoArtboard'
import VideoMediaInput from './VideoMediaInput'
import VideoModelSelector from './VideoModelSelector'

const logger = loggerService.withContext('creation/VideoPage')

/**
 * Video tab of the unified Creation page. Mirrors the painting page layout
 * (settings panel | stage + prompt | history strip) but drives everything off
 * `useVideoGenerationSupport`: mode tabs + media pickers + scalar fields come
 * from the registry's `videoGeneration` block, and generation goes through
 * `generateVideoRequest` → `window.api.ai.generateVideo` (job system).
 *
 * Lean by design: generation is awaited in-place (no cross-page spinner
 * rehydration like the image page's cache mirror), and reference-image / video
 * inputs beyond first/last frame are not yet surfaced.
 */
const VideoPage: FC = () => {
  const { t } = useTranslation()
  const { createCreation, deleteCreation } = useCreations('video')
  const { items: historyItems, hasMore, loadMore } = usePaintingHistory('video')

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

  const onSelectHistory = useCallback((item: PaintingData) => {
    setProviderId(item.providerId)
    setModelId(item.model)
    setPrompt(item.prompt)
    setFiles(item.files)
    setCurrentId(item.id)
    setFirstFrame(undefined)
    setLastFrame(undefined)
  }, [])

  const onDeleteHistory = useCallback(
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
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className="flex h-full flex-1 flex-col">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <div className={paintingClasses.panel}>
                <div className={paintingClasses.panelModelSelector}>
                  <VideoModelSelector
                    className={paintingClasses.panelModelSelectorTrigger}
                    providerId={providerId}
                    modelId={modelId}
                    onSelect={onSelectModel}
                  />
                </div>
                <div className={paintingClasses.panelBody}>
                  <Scrollbar className={paintingClasses.panelScroll}>
                    {modes.length > 1 && (
                      <Tabs value={mode} onValueChange={(value) => setMode(value as VideoGenerationMode)}>
                        <TabsList className={paintingClasses.promptModeTabsList}>
                          {modes.map((m) => (
                            <TabsTrigger key={m} value={m} className={paintingClasses.promptModeTabsTrigger}>
                              {t(`paintings.video.mode_options.${m}`, m)}
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
                        {item.title && <PaintingSectionTitle>{t(item.title)}</PaintingSectionTitle>}
                        <PaintingFieldRenderer
                          item={item}
                          painting={params}
                          onChange={onParamsChange}
                          onGenerateRandomSeed={(key) =>
                            onParamsChange({ [key]: String(Math.floor(Math.random() * 1_000_000)) })
                          }
                        />
                      </div>
                    ))}
                  </Scrollbar>
                </div>
              </div>

              <div className={paintingClasses.centerPane}>
                <div className={paintingClasses.centerStage}>
                  <VideoArtboard files={files} isLoading={generating} onCancel={onCancel} />
                </div>
                <div className={paintingClasses.promptDock}>
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
                </div>
              </div>

              <div
                className={paintingClasses.historyStrip}
                onScroll={(e) => {
                  // ponytail: load the next page when scrolled near the bottom
                  const el = e.currentTarget
                  if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 80) loadMore()
                }}>
                <button
                  type="button"
                  className={paintingClasses.historyAddButton}
                  onClick={resetDraft}
                  aria-label={t('paintings.video.new')}>
                  <Plus className="size-4" />
                </button>
                {historyItems.map((item) => {
                  const cover = item.files[0]
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        paintingClasses.historyItem,
                        item.id === currentId && paintingClasses.historyItemActive
                      )}>
                      <button
                        type="button"
                        onClick={() => onSelectHistory(item)}
                        className="size-full overflow-hidden rounded-[12px]"
                        title={item.prompt}>
                        {cover ? (
                          <video
                            src={FileManager.getFileUrl(cover)}
                            muted
                            preload="metadata"
                            className="size-full rounded-[12px] object-cover">
                            <track kind="captions" />
                          </video>
                        ) : (
                          <Film className="size-4 text-muted-foreground" />
                        )}
                      </button>
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={() => onDeleteHistory(item.id)}
                        className={paintingClasses.historyDelete}>
                        <X className="size-3" />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoPage
