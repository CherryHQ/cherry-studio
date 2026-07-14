import { useModels } from '@renderer/hooks/useModel'
import type { CreationModelKindSelection } from '@renderer/pages/creation/CreationModelSelector'
import type { FileEntry } from '@shared/data/types/file'
import { imageExts } from '@shared/utils/file'
import { isEditImageModel } from '@shared/utils/model'
import { type FC, useCallback, useMemo } from 'react'

import CreationComposer from '../../components/CreationComposer'
import { imageGenerationToFields } from '../../form/imageGenerationToFields'
import { useImageGenerationSupport } from '../../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'

const PAINTING_IMAGE_EXTS = imageExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))

export interface PaintingComposerProps {
  painting: PaintingData
  generating: boolean
  onPromptChange: (value: string) => void
  onInputFilesChange: (files: FileEntry[]) => void
  onGenerate: () => void
  onCancel: () => void
  /** Kind-aware: selecting a video model hands the page off to the video flow. */
  onModelSelect: (selection: CreationModelKindSelection) => void
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

/**
 * The image mode's prompt bar — a thin wrapper over the shared
 * `CreationComposer`: image inputs flow through the composer's flat attachment
 * pipeline (edit-capable models only), and the params popover is derived from
 * the registry's `imageGeneration` block for the active mode.
 */
const PaintingComposer: FC<PaintingComposerProps> = ({
  painting,
  generating,
  onPromptChange,
  onInputFilesChange,
  onGenerate,
  onCancel,
  onModelSelect,
  onConfigChange,
  onGenerateRandomSeed
}) => {
  const { models } = useModels(painting.providerId ? { providerId: painting.providerId } : undefined)
  const model = useMemo(
    () =>
      painting.model
        ? models.find((entry) => entry.providerId === painting.providerId && entry.apiModelId === painting.model)
        : undefined,
    [models, painting.providerId, painting.model]
  )
  const couldAddImageFile = model ? isEditImageModel(model) : false

  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const paramsItems = useMemo(
    () => imageGenerationToFields(registrySupport, { mode: tabToImageGenerationMode(painting.mode) }),
    [registrySupport, painting.mode]
  )
  const paintingParams = painting.params ?? {}

  // The form's reads/writes target `painting.params` — the canonical-name bag
  // that `canonicalGenerate` partitions into AI SDK args vs provider bag at
  // request time. Top-level PaintingData fields are not visible to the wire.
  const onParamsChange = useCallback(
    (updates: Record<string, unknown>) =>
      onConfigChange({ params: { ...painting.params, ...updates } } as Partial<PaintingData>),
    [onConfigChange, painting.params]
  )

  return (
    <CreationComposer
      // Keying on the model too is what reconciles an external `inputFiles`
      // clear: switchModel drops input images for a generate-only model on the
      // same painting id, and without the model in the key the once-per-id seed
      // would never re-run, leaving a stale chip that the writeback could
      // resurrect and send to a model that can't accept it.
      composerKey={`${painting.id}:${painting.model ?? ''}`}
      providerId={painting.providerId}
      modelId={painting.model}
      model={model}
      prompt={painting.prompt ?? ''}
      generating={generating}
      onPromptChange={onPromptChange}
      onGenerate={onGenerate}
      onCancel={onCancel}
      onModelSelect={onModelSelect}
      canSend={({ text, filesCount }) => text.trim().length > 0 || filesCount > 0}
      attachments={{
        couldAddImageFile,
        extensions: PAINTING_IMAGE_EXTS,
        inputFiles: painting.inputFiles ?? [],
        onInputFilesChange
      }}
      paramsConfig={{
        items: paramsItems,
        params: paintingParams,
        onChange: onParamsChange,
        onGenerateRandomSeed
      }}
    />
  )
}

export default PaintingComposer
