import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import type { PaintingMode, PaintingStepStatus } from '@shared/data/types/painting'

export type PaintingGenerationStatus = 'running' | 'failed' | 'canceled'

/** Selected project step plus the next instruction being authored in the composer. */
export interface PaintingData {
  id: string
  projectId?: string | null
  parentId?: string | null
  sourceFileId?: string | null
  selectedFileId?: string | null
  selectedStepId?: string | null
  operation?: 'generate' | 'edit' | 'import'
  stepNumber?: number
  operationPrompt?: string
  stepStatus?: PaintingStepStatus
  stepError?: string | null
  providerId: string
  mode: PaintingMode
  model?: string
  prompt: string
  previewFile?: FileMetadata
  files: FileMetadata[]
  inputFiles?: FileEntry[]
  persistedAt?: string
  generationStatus?: PaintingGenerationStatus | null
  generationTaskId?: string | null
  generationError?: string | null
  generationProgress?: number | null
  /**
   * Free-form bag of canonical param values. Keys correspond to registry
   * `imageGeneration.modes[currentMode].supports.{key}`. The form writes
   * each control's value here; `canonicalGenerate` partitions entries into
   * `aiSdkParams` (AI SDK native fields) and `providerOptions[providerId]`
   * (vendor-specific) at request time. Empty / undefined entries are
   * omitted from the wire — server applies its default.
   */
  params?: Record<string, unknown>
}
