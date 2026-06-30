import fs from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

import { application } from '@application'
import { loggerService } from '@logger'
import { LOCAL_MODELS, type RemoteModelFile } from '@main/ai/inference/localModelCatalog'
import { modelSourceOrder, resolveModelFileUrl } from '@main/ai/inference/modelSource'
import {
  isLocalPaddleocrModelDownloaded,
  ocrModelDir,
  ocrModelPaths
} from '@main/features/fileProcessing/processors/local-paddleocr/modelPaths'
import type { LocalModelStatus } from '@shared/data/presets/localModel'
import { app, net } from 'electron'
import { parse } from 'yaml'

const logger = loggerService.withContext('LocalOcrDownloadService')

/**
 * Build PaddleOCR's on-disk dictionary from the recognition model's
 * `inference.yml`. The `*_onnx` repos ship the dictionary only inside that
 * config (under `PostProcess.character_dict`), not as a standalone file.
 *
 * Format matters: ppu-paddle-ocr reads the dictionary file with
 * `split(/\r?\n/)` and no trimming, then its CTC decoder treats index 0 as the
 * blank token and the trailing entry as the space class. So the file must be a
 * leading blank line, the `character_dict` entries, then a trailing newline —
 * which reproduces the dictionary byte-for-byte.
 */
export function dictTextFromInferenceYml(yml: string): string {
  const config = parse(yml) as { PostProcess?: { character_dict?: unknown } } | null
  const characters = config?.PostProcess?.character_dict
  if (!Array.isArray(characters) || characters.length === 0) {
    throw new Error('inference.yml is missing PostProcess.character_dict')
  }
  return `\n${characters.map(String).join('\n')}\n`
}

/**
 * On-disk lifecycle of the local PaddleOCR model: status probe, download (with
 * mirror fallback + aggregate progress broadcast to the renderer), cancel, and
 * remove. Stateless across restarts — the source of truth is the files on disk.
 */
class LocalOcrDownloadService {
  private downloading = false
  private abortController: AbortController | null = null

  getStatus(): LocalModelStatus {
    if (this.downloading) return 'downloading'
    return isLocalPaddleocrModelDownloaded() ? 'ready' : 'not_downloaded'
  }

  async download(): Promise<void> {
    if (this.downloading) return
    this.downloading = true
    this.abortController = new AbortController()
    const { signal } = this.abortController
    const paths = ocrModelPaths()
    const weights = LOCAL_MODELS.ocr.weights
    // The dictionary is a tiny fetch-and-parse step; weight it lightly so the
    // bar doesn't sit at 100% while it finishes.
    const DICTIONARY_WEIGHT = 1
    const totalWeight = Object.values(weights).reduce((sum, file) => sum + file.weight, 0) + DICTIONARY_WEIGHT
    try {
      await fs.promises.mkdir(ocrModelDir(), { recursive: true })
      let doneWeight = 0
      for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
        const file = weights[key]
        await this.downloadFile(file, paths[key], signal, (fraction) => {
          const percent = Math.round((100 * (doneWeight + file.weight * fraction)) / totalWeight)
          this.broadcast({ status: 'downloading', percent })
        })
        doneWeight += file.weight
      }
      // The character dictionary lives only inside the recognition model's
      // inference.yml (not as a standalone file in the *_onnx repos) — fetch and
      // parse it so the model dir holds all three files the inference worker needs.
      await this.downloadDictionary(paths.charactersDictionary, signal)
      this.broadcast({ status: 'ready', percent: 100 })
      // Product decision: downloading the local OCR model promotes it to the
      // default image-to-text processor. Best-effort — a preference write hiccup
      // must not undo a successful download.
      await this.promoteToDefault()
    } catch (error) {
      logger.error('local OCR model download failed', error as Error)
      // Drop partials so the next probe reports not_downloaded rather than ready.
      await this.cleanup()
      this.broadcast({ status: 'error', percent: 0 })
      throw error
    } finally {
      this.downloading = false
      this.abortController = null
    }
  }

  cancel(): void {
    this.abortController?.abort(new Error('download cancelled'))
  }

  async remove(): Promise<{ removed: boolean }> {
    // Reset the default first: leaving `default_image_to_text` pinned to
    // local-paddleocr after deleting the weights makes resolveProcessorConfigByFeature
    // throw for every OCR consumer (translation / chat attachments / read_file), with
    // no self-heal. Clearing it lets the platform default take over again.
    await this.demoteFromDefault()
    await this.cleanup()
    return { removed: true }
  }

  /** Try each mirror (locale default first) in order; the first valid file wins. */
  private async downloadFile(
    file: RemoteModelFile,
    dest: string,
    signal: AbortSignal,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    const urls = modelSourceOrder(app.getLocale()).map((id) => resolveModelFileUrl(id, file.repo, file.remoteFile))
    let lastError: unknown
    for (const url of urls) {
      try {
        await this.fetchToFile(url, dest, file.minBytes, signal, onProgress)
        return
      } catch (error) {
        if (signal.aborted) throw error
        lastError = error
        logger.warn(`mirror failed for ${file.fileName}, trying next`, { url, error: String(error) })
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`failed to download ${file.fileName}`)
  }

  /** Fetch the recognition model's inference.yml (mirror fallback) and write the parsed dict. */
  private async downloadDictionary(dest: string, signal: AbortSignal): Promise<void> {
    const { repo, sourceFile } = LOCAL_MODELS.ocr.dictionary
    const urls = modelSourceOrder(app.getLocale()).map((id) => resolveModelFileUrl(id, repo, sourceFile))
    let lastError: unknown
    for (const url of urls) {
      try {
        const response = await net.fetch(url, { signal })
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
        const dictText = dictTextFromInferenceYml(await response.text())
        const tmp = `${dest}.tmp`
        await fs.promises.writeFile(tmp, dictText)
        await fs.promises.rename(tmp, dest)
        return
      } catch (error) {
        if (signal.aborted) throw error
        lastError = error
        logger.warn('dictionary mirror failed, trying next', { url, error: String(error) })
      }
    }
    throw lastError instanceof Error ? lastError : new Error('failed to download OCR dictionary')
  }

  private async fetchToFile(
    url: string,
    dest: string,
    minBytes: number,
    signal: AbortSignal,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    const response = await net.fetch(url, { signal })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

    const total = Number(response.headers.get('content-length')) || 0
    const tmp = `${dest}.tmp`
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (total > 0) onProgress(received / total)
        callback(null, chunk)
      }
    })

    try {
      // net.fetch's body is the DOM ReadableStream; Readable.fromWeb wants the
      // node:stream/web flavour — same runtime object, divergent lib types.
      const webStream = response.body as unknown as NodeWebReadableStream<Uint8Array>
      await pipeline(Readable.fromWeb(webStream), counter, fs.createWriteStream(tmp), { signal })
    } catch (error) {
      await fs.promises.rm(tmp, { force: true })
      throw error
    }

    // LFS pointers / error pages are tiny; reject so a fallback mirror can run.
    if (received < minBytes) {
      await fs.promises.rm(tmp, { force: true })
      throw new Error(`download from ${url} too small (${received} bytes)`)
    }
    await fs.promises.rename(tmp, dest)
    onProgress(1)
  }

  private async promoteToDefault(): Promise<void> {
    try {
      await application.get('PreferenceService').set('feature.file_processing.default_image_to_text', 'local-paddleocr')
    } catch (error) {
      logger.warn('failed to set local OCR as default image-to-text processor', { error: String(error) })
    }
  }

  /** Inverse of {@link promoteToDefault}: only resets when we are still the default. */
  private async demoteFromDefault(): Promise<void> {
    try {
      const preference = application.get('PreferenceService')
      if (preference.get('feature.file_processing.default_image_to_text') === 'local-paddleocr') {
        // null → resolveProcessorConfigByFeature falls back to the platform default.
        await preference.set('feature.file_processing.default_image_to_text', null)
      }
    } catch (error) {
      logger.warn('failed to reset default image-to-text processor on OCR model removal', { error: String(error) })
    }
  }

  private async cleanup(): Promise<void> {
    await fs.promises.rm(ocrModelDir(), { recursive: true, force: true })
  }

  private broadcast(payload: { status: string; percent: number }): void {
    application.get('IpcApiService').broadcast('local_model.download_progress', { model: 'ocr', ...payload })
  }
}

export const localOcrDownloadService = new LocalOcrDownloadService()
