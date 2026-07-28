import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  ONNXRUNTIME_LEAVES,
  ONNXRUNTIME_NODE_VERSION,
  ONNXRUNTIME_TARBALL_SHA256
} from '@main/ai/inference/localModelCatalog'
import { regionService } from '@main/services/RegionService'
import { net } from 'electron'
import { extract } from 'tar'

const logger = loggerService.withContext('OnnxRuntimeBinaryService')

/** npmmirror.com is a byte-identical registry mirror (same as BinaryManager's China npm
 * mirror behavior) — safe regardless of order since the whole tarball is sha256-verified
 * against ONNXRUNTIME_TARBALL_SHA256 after download, independent of which mirror served it. */
const NPM_REGISTRIES = {
  npmjs: 'https://registry.npmjs.org',
  npmmirror: 'https://registry.npmmirror.com'
} as const

function tarballUrl(registryBase: string): string {
  return `${registryBase}/onnxruntime-node/-/onnxruntime-node-${ONNXRUNTIME_NODE_VERSION}.tgz`
}

/** Mirrors to try in order: the region default first, the other as fallback (same
 * region-detection signal as LocalOcrDownloadService's model mirror order). */
async function tarballUrlOrder(): Promise<string[]> {
  const inChina = await regionService.isInChina().catch(() => false)
  const registries = inChina
    ? [NPM_REGISTRIES.npmmirror, NPM_REGISTRIES.npmjs]
    : [NPM_REGISTRIES.npmjs, NPM_REGISTRIES.npmmirror]
  return registries.map(tarballUrl)
}

/**
 * Downloads and verifies the onnxruntime-node native binary (napi addon + shared lib)
 * for the current platform/arch on first use of local embedding or local OCR. The
 * package is no longer bundled at build time (see electron-builder.yml/before-pack.js) —
 * `onnxruntime-node`'s `dist/binding.js` is patched (see patches/onnxruntime-node@1.24.3.patch)
 * to require this downloaded copy via `CHERRY_ONNXRUNTIME_BINDING_PATH` instead of its own
 * bundled-relative path.
 *
 * Not a `LocalModelDownloadService` subclass: this has no `LocalModelKind`, no IPC route, no
 * settings card — it is a silent prerequisite folded into `LocalEmbeddingDownloadService` and
 * `LocalOcrDownloadService`'s own `performDownload()`/`isReady()`. Whichever feature is
 * downloaded first pays for it; the second one finds it already present. It has no `remove()`
 * of its own either — the IPC layer (`src/main/ipc/handlers/localModel.ts`) calls
 * `removeIfUnused()` after either feature's own removal succeeds, once neither still needs it.
 */
class OnnxRuntimeBinaryService {
  /** Coalesces concurrent callers (embedding + OCR downloads racing each other). */
  private inFlight: Promise<void> | null = null

  private leaf() {
    return ONNXRUNTIME_LEAVES[process.platform]?.[process.arch]
  }

  private leafDir(): string {
    return path.join(application.getPath('feature.onnxruntime.binary'), 'napi-v6', process.platform, process.arch)
  }

  /** Absolute path to the native `.node` binding — set as `CHERRY_ONNXRUNTIME_BINDING_PATH`
   * before the inference worker's first (lazy) `require('onnxruntime-node')`. */
  bindingPath(): string {
    const leaf = this.leaf()
    return path.join(this.leafDir(), leaf?.binding ?? '')
  }

  /** Whether the binary is present for the current platform/arch. `true` on an unsupported
   * platform (darwin-x64) — the `isDarwinX64` gate already blocks callers before they get here. */
  isReady(): boolean {
    const leaf = this.leaf()
    if (!leaf) return true
    const dir = this.leafDir()
    return fs.existsSync(path.join(dir, leaf.binding)) && leaf.sharedLibs.every((f) => fs.existsSync(path.join(dir, f)))
  }

  /** Idempotent: no-ops if already present. Coalesces concurrent callers. */
  async ensure(signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.isReady()) return
    if (this.inFlight) return this.inFlight
    this.inFlight = this.performDownload(signal, onProgress).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  /** Deletes the shared binary once neither local-model feature needs it anymore.
   * `otherModelStillPresent` is the sibling feature's current status — the caller
   * checks it before this binary is gone, so it's still an accurate signal. */
  async removeIfUnused(otherModelStillPresent: boolean): Promise<void> {
    if (otherModelStillPresent) return
    await fs.promises.rm(application.getPath('feature.onnxruntime.binary'), { recursive: true, force: true })
  }

  private async performDownload(signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void> {
    const leaf = this.leaf()
    if (!leaf) return // unsupported platform — nothing to download

    const toolchainDir = application.getPath('feature.onnxruntime.binary')
    const tmpDir = path.join(toolchainDir, '.tmp')
    await fs.promises.mkdir(tmpDir, { recursive: true })
    const tarballPath = path.join(tmpDir, `onnxruntime-node-${ONNXRUNTIME_NODE_VERSION}.tgz.tmp`)
    const extractDir = path.join(tmpDir, `extract-${process.platform}-${process.arch}`)

    try {
      await this.downloadTarball(tarballPath, signal, onProgress)
      await this.verifyTarball(tarballPath)
      await this.extractLeaf(tarballPath, extractDir, leaf)
      await this.installLeaf(extractDir, leaf)
    } finally {
      // Drop the whole staging dir, not just the tarball + extract dir inside it —
      // a cancelled download would otherwise leave an empty `.tmp` behind.
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  }

  /** Streams the npm tarball to a temp file, reporting byte-progress (mirrors
   * LocalOcrDownloadService.fetchToFile's streaming-pipeline style). Tries each registry
   * mirror in region order; the first that responds OK wins (same fallback shape as
   * LocalOcrDownloadService.downloadFile). */
  private async downloadTarball(
    dest: string,
    signal: AbortSignal,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const urls = await tarballUrlOrder()
    let lastError: unknown
    for (const url of urls) {
      try {
        await this.downloadTarballFrom(url, dest, signal, onProgress)
        return
      } catch (error) {
        if (signal.aborted) throw error
        lastError = error
        logger.warn('onnxruntime-node tarball mirror failed, trying next', { url, error: String(error) })
      }
    }
    throw lastError instanceof Error ? lastError : new Error('failed to download onnxruntime-node tarball')
  }

  private async downloadTarballFrom(
    url: string,
    dest: string,
    signal: AbortSignal,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const response = await net.fetch(url, { signal })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

    const total = Number(response.headers.get('content-length')) || 0
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (total > 0) onProgress?.(received / total)
        callback(null, chunk)
      }
    })

    const webStream = response.body as unknown as NodeWebReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(webStream), counter, fs.createWriteStream(dest), { signal })
    onProgress?.(1)
  }

  /** Whole-tarball sha256 check — the platform leaf is extracted from this same verified
   * stream, so there is no separate sub-file checksum to obtain or need. */
  private async verifyTarball(tarballPath: string): Promise<void> {
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(tarballPath), hash)
    const digest = hash.digest('hex')
    if (digest !== ONNXRUNTIME_TARBALL_SHA256) {
      throw new Error(`onnxruntime-node tarball sha256 mismatch: expected ${ONNXRUNTIME_TARBALL_SHA256}, got ${digest}`)
    }
  }

  /** Extracts only the current platform/arch leaf's binding + shared libs, flattened
   * (npm tarball entries are `package/bin/napi-v6/<platform>/<arch>/<file>` — strip 5
   * segments so they land directly as `<file>` under `extractDir`). */
  private async extractLeaf(
    tarballPath: string,
    extractDir: string,
    leaf: { binding: string; sharedLibs: string[] }
  ): Promise<void> {
    await fs.promises.mkdir(extractDir, { recursive: true })
    const wanted = new Set([leaf.binding, ...leaf.sharedLibs])
    const leafPrefix = `package/bin/napi-v6/${process.platform}/${process.arch}/`
    await extract({
      file: tarballPath,
      cwd: extractDir,
      strip: 5,
      filter: (entryPath) => entryPath.startsWith(leafPrefix) && wanted.has(path.basename(entryPath))
    })
    for (const file of wanted) {
      if (!fs.existsSync(path.join(extractDir, file))) {
        throw new Error(`onnxruntime-node tarball is missing expected file: ${leafPrefix}${file}`)
      }
    }
  }

  /** Atomically moves the verified/extracted files into the final leaf directory. */
  private async installLeaf(extractDir: string, leaf: { binding: string; sharedLibs: string[] }): Promise<void> {
    const dir = this.leafDir()
    await fs.promises.mkdir(dir, { recursive: true })
    for (const file of [leaf.binding, ...leaf.sharedLibs]) {
      await fs.promises.rename(path.join(extractDir, file), path.join(dir, file))
    }
    logger.info('onnxruntime-node native binary installed', { dir })
  }
}

export const onnxRuntimeBinaryService = new OnnxRuntimeBinaryService()
