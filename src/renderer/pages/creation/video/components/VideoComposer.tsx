import { useModels } from '@renderer/hooks/useModel'
import type { FileEntry } from '@shared/data/types/file'
import type { VideoGenerationMode, VideoGenerationSupport } from '@shared/data/types/model'
import { type FC, useCallback, useMemo } from 'react'

import CreationComposer from '../../components/CreationComposer'
import type { CreationModelKindSelection } from '../../CreationModelSelector'
import { videoGenerationToFields } from '../../form/videoGenerationToFields'
import VideoMediaSlots from './VideoMediaSlots'
import VideoModePills from './VideoModePills'

export interface VideoComposerProps {
  /** Remount key: the current creation id or a draft epoch (re-seeds the prompt). */
  composerKey: string
  providerId?: string
  modelId?: string
  prompt: string
  generating: boolean
  /** The model's registry `videoGeneration` block (page-owned — it also drives generate/clamp/defaults). */
  support?: VideoGenerationSupport
  mode: VideoGenerationMode
  onModeChange: (mode: VideoGenerationMode) => void
  params: Record<string, unknown>
  onParamsChange: (updates: Record<string, unknown>) => void
  firstFrame?: FileEntry
  lastFrame?: FileEntry
  onFirstFrameChange: (entry?: FileEntry) => void
  onLastFrameChange: (entry?: FileEntry) => void
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onCancel: () => void
  onModelSelect: (selection: CreationModelKindSelection) => void
}

/**
 * The video mode's prompt bar — a thin wrapper over the shared
 * `CreationComposer`. Everything model-specific is registry-driven: mode pills
 * appear only when the model declares >1 mode, media placeholder slots
 * (first/last frame) come from the active mode's `mediaInputs`, and the params
 * popover from its `supports`. Video opts out of the flat attachment pipeline —
 * media roles matter, so the slots are the only media entry point.
 */
const VideoComposer: FC<VideoComposerProps> = ({
  composerKey,
  providerId,
  modelId,
  prompt,
  generating,
  support,
  mode,
  onModeChange,
  params,
  onParamsChange,
  firstFrame,
  lastFrame,
  onFirstFrameChange,
  onLastFrameChange,
  onPromptChange,
  onGenerate,
  onCancel,
  onModelSelect
}) => {
  const { models } = useModels(providerId ? { providerId } : undefined)
  const model = useMemo(
    () =>
      modelId ? models.find((entry) => entry.providerId === providerId && entry.apiModelId === modelId) : undefined,
    [models, providerId, modelId]
  )

  const modes = useMemo(() => Object.keys(support?.modes ?? {}) as VideoGenerationMode[], [support])
  const modeDef = support?.modes?.[mode]
  const paramsItems = useMemo(() => videoGenerationToFields(support, { mode }), [support, mode])

  const onGenerateRandomSeed = useCallback(
    (key: string) => onParamsChange({ [key]: String(Math.floor(Math.random() * 1_000_000)) }),
    [onParamsChange]
  )

  // Honor the registry's requirePrompt (default true): an i2v generation may
  // stand on the first frame alone; a requirePrompt:false model sends empty.
  const requirePrompt = modeDef?.requirePrompt ?? true
  const canSend = useCallback(
    ({ text }: { text: string; filesCount: number }) => !requirePrompt || text.trim().length > 0 || Boolean(firstFrame),
    [requirePrompt, firstFrame]
  )

  return (
    <CreationComposer
      composerKey={composerKey}
      providerId={providerId}
      modelId={modelId}
      model={model}
      prompt={prompt}
      generating={generating}
      onPromptChange={onPromptChange}
      onGenerate={onGenerate}
      onCancel={onCancel}
      onModelSelect={onModelSelect}
      canSend={canSend}
      paramsConfig={{
        items: paramsItems,
        params,
        onChange: onParamsChange,
        onGenerateRandomSeed
      }}
      toolbarLeading={<VideoModePills modes={modes} mode={mode} onChange={onModeChange} disabled={generating} />}
      // Pass the header only when the mode declares slots, so the surface
      // doesn't render an empty header row for t2v.
      headerContent={
        modeDef?.mediaInputs?.firstFrame || modeDef?.mediaInputs?.lastFrame ? (
          <VideoMediaSlots
            mediaInputs={modeDef.mediaInputs}
            firstFrame={firstFrame}
            lastFrame={lastFrame}
            disabled={generating}
            onFirstFrameChange={onFirstFrameChange}
            onLastFrameChange={onLastFrameChange}
          />
        ) : undefined
      }
    />
  )
}

export default VideoComposer
