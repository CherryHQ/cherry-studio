import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import type { ImageGenerationMode } from '@shared/data/types/model'

import { fileEntryToMetadata } from '../utils/fileEntryAdapter'
import { runPainting } from './runPainting'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

/**
 * Shared painting generate skeleton. Image generation runs in the MAIN process
 * via the `ai.generate_image` IpcApi route (`ipcApi.request`): the renderer
 * sends one canonical `paramValues` bag (+ encoded input images); main derives
 * the AI SDK request + per-vendor `providerOptions` from it (`splitParamValues`
 * + the WireProfile engine), runs any async submit/poll loop, and returns
 * base64 data URLs. Validation (model / prompt required, custom-size rules,
 * param coercion) stays in the caller (`canonicalGenerate`).
 */
export interface GeneratePaintingOptions {
  /** Painting provider runtime (id, name, apiHost, isEnabled). */
  readonly provider: PaintingProviderRuntime
  /** Abort signal — usually `input.abortController.signal`. */
  readonly signal: AbortSignal
  /** Model id chosen by the user; assumed non-empty (caller validates). */
  readonly modelId: string
  /** User-entered prompt; pass `''` when the model allows empty prompts. */
  readonly prompt: string
  /** Resolved image-generation mode — lets main derive per-model transport
   *  routing from the registry instead of the renderer injecting it. */
  readonly mode?: ImageGenerationMode
  /**
   * Canonical param bag (registry param keys → coerced values; blanks dropped,
   * customSize composed into `size`). main partitions it (`splitParamValues`)
   * and maps it onto each vendor's wire shape — no per-vendor logic here.
   */
  readonly paramValues: Record<string, unknown>
  /** Attached input images, already encoded as `data:` URL strings. */
  readonly inputImages?: string[]
}

export function generatePainting(opts: GeneratePaintingOptions): Promise<FileMetadata[]> {
  return runPainting(async () => {
    const requestId = crypto.randomUUID()
    const onAbort = () => void ipcApi.request('ai.abort_image', { requestId })
    opts.signal.addEventListener('abort', onAbort, { once: true })
    const result = await ipcApi
      .request('ai.generate_image', {
        requestId,
        payload: {
          uniqueModelId: `${opts.provider.id}::${opts.modelId}`,
          prompt: opts.prompt,
          ...(opts.mode && { mode: opts.mode }),
          paramValues: opts.paramValues,
          // Painting-owned images: reaped once no painting references them (file-entry-cleanup.md §4.1).
          cleanupPolicy: 'delete_when_unreferenced',
          ...(opts.inputImages && opts.inputImages.length > 0 && { inputImages: opts.inputImages })
        }
      })
      // A failure now crosses IpcApi as an IpcError (name 'IpcError'), so an abort would
      // no longer satisfy runPainting's `name === 'AbortError'` cancel check. When the
      // user aborted, re-throw a real AbortError to preserve the silent-cancel behaviour.
      .catch((error) => {
        if (opts.signal.aborted) throw new DOMException('Image generation aborted', 'AbortError')
        throw error
      })
      .finally(() => opts.signal.removeEventListener('abort', onAbort))

    if (opts.signal.aborted) {
      throw new DOMException('Image generation aborted', 'AbortError')
    }
    if (result.files.length === 0) {
      return undefined
    }

    // main already persisted the images (`createInternalEntry`); just adapt the
    // returned v2 `FileEntry` rows to the v1 `FileMetadata` the painting state
    // still consumes. No base64 round-trip.
    const files = await Promise.all(result.files.map(fileEntryToMetadata))
    return files.length > 0 ? { files } : undefined
  })
}
