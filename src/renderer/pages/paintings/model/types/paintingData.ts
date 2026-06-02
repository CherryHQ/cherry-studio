import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { PaintingMode } from '@shared/data/types/painting'

export type PaintingGenerationStatus = 'running' | 'failed' | 'canceled'

/**
 * Renderer-side painting draft / display state.
 *
 * Unified shape: every model's tunable params live in `params` keyed by the
 * canonical name declared on the registry's
 * `imageGeneration.modes[mode].supports.{key}`. The 8 vendor-specific
 * variants that used to enumerate ad-hoc fields (`SiliconPaintingData`,
 * `OvmsPaintingData`, `AihubmixPaintingData`, etc.) are gone — vendor
 * differences flow through the registry's `supports` map and (where they
 * carry wire-format quirks) the AI SDK adapter in
 * `aiCore/provider/custom/`.
 *
 * `mode` is a live form/draft concern only — the persisted painting record
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
   * Free-form bag of canonical param values. Keys correspond to registry
   * `imageGeneration.modes[currentMode].supports.{key}`. The form writes
   * each control's value here; `canonicalGenerate` partitions entries into
   * `aiSdkParams` (AI SDK native fields) and `providerOptions[providerId]`
   * (vendor-specific) at request time. Empty / undefined entries are
   * omitted from the wire — server applies its default.
   */
  params?: Record<string, unknown>
}
