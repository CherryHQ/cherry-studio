import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import type { PaintingMode } from '@shared/data/types/painting'

export type PaintingGenerationStatus = 'running' | 'failed' | 'canceled'

/**
 * Renderer-side painting draft / display state.
 *
 * Tunable params use canonical keys from the effective image capability's
 * `supports`. Main's SDK/protocol boundary owns vendor wire encoding.
 *
 * `mode` is live UI draft state, not protocol — the persisted painting record
 * (`Painting` in `@shared/data/types/painting`) does NOT carry mode.
 * `mediaType` is similarly not persisted; image vs video is derived from
 * `files` at display time when needed.
 *
 * `inputFiles` is v2-native `FileEntry[]` (the prompt-box attachment
 * surface registers each File via `window.api.file.createInternalEntry`
 * and pushes the returned `FileEntry`). `files` (output) still uses v1
 * `FileMetadata` until the `cherrystudio://file/internal/{uuid}.{ext}`
 * custom protocol cleanup tracked at TODO #15353 lands.
 */
export interface PaintingData {
  id: string
  providerId: string
  mode: PaintingMode
  model?: string
  prompt: string
  files: FileMetadata[]
  inputFiles?: FileEntry[]
  persistedAt?: string
  generationStatus?: PaintingGenerationStatus | null
  generationTaskId?: string | null
  generationError?: string | null
  generationProgress?: number | null
  /**
   * Draft canonical values; `canonicalGenerate` validates against the effective
   * capability and sends one `paramValues` bag. Main owns SDK/protocol encoding.
   */
  params?: Record<string, unknown>
}
