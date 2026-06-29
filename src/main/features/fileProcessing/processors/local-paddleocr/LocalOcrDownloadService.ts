import fs from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

import { application } from '@application'
import { loggerService } from '@logger'
import type { LocalModelStatus } from '@shared/data/presets/localEmbedding'
import { net } from 'electron'

import { isLocalPaddleocrModelDownloaded, OCR_MODEL_FILES, ocrModelDir, ocrModelPaths } from './modelAssets'

const logger = loggerService.withContext('LocalOcrDownloadService')

type OcrModelFile = (typeof OCR_MODEL_FILES)[keyof typeof OCR_MODEL_FILES]

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
    const totalWeight = Object.values(OCR_MODEL_FILES).reduce((sum, file) => sum + file.weight, 0)
    try {
      await fs.promises.mkdir(ocrModelDir(), { recursive: true })
      let doneWeight = 0
      for (const key of Object.keys(OCR_MODEL_FILES) as (keyof typeof OCR_MODEL_FILES)[]) {
        const file = OCR_MODEL_FILES[key]
        await this.downloadFile(file, paths[key], signal, (fraction) => {
          const percent = Math.round((100 * (doneWeight + file.weight * fraction)) / totalWeight)
          this.broadcast({ status: 'downloading', percent })
        })
        doneWeight += file.weight
      }
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

  async remove(): Promise<void> {
    await this.cleanup()
  }

  /** Try each mirror URL in order; the first that yields a valid file wins. */
  private async downloadFile(
    file: OcrModelFile,
    dest: string,
    signal: AbortSignal,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    let lastError: unknown
    for (const url of file.urls) {
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

  private async cleanup(): Promise<void> {
    await fs.promises.rm(ocrModelDir(), { recursive: true, force: true })
  }

  private broadcast(payload: { status: string; percent: number }): void {
    application.get('IpcApiService').broadcast('local_model.download_progress', { model: 'ocr', ...payload })
  }
}

export const localOcrDownloadService = new LocalOcrDownloadService()
