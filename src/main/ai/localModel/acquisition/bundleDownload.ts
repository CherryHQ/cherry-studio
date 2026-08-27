import path from 'node:path'

import { regionService } from '@main/services/RegionService'

import type { BundleFile, ModelBundle } from '../registry/types'
import { applyDerivation } from './derivations'
import { fetchTextVerified, streamToFileVerified, withMirrorFallback, writeFileAtomic } from './downloadEngine'
import { modelSourceOrder, resolveModelFileUrl } from './modelSource'

/**
 * Fetching a bundle: one mirror decision for the whole run, one weighted progress bar
 * across the files that are actually missing, and each file verified before it lands.
 */

export interface BundleDownloadOptions {
  signal: AbortSignal
  /** Absolute directory the files are written under. */
  installDir: string
  /** 0–1 across `files`, weighted by {@link BundleFile.weight}. */
  onProgress?: (fraction: number) => void
}

/**
 * Download `files` (a subset of `bundle`'s, normally the ones missing from disk) into
 * `installDir`.
 *
 * The region signal is read once for the run rather than per file: it decides mirror
 * *order* only, and files disagreeing about which mirror to try first would be strictly
 * worse than files that do not.
 */
export async function downloadBundleFiles(
  bundle: ModelBundle,
  files: readonly BundleFile[],
  options: BundleDownloadOptions
): Promise<void> {
  const { signal, installDir, onProgress } = options
  const inChina = await regionService.isInChina().catch(() => false)
  const sourceOrder = modelSourceOrder(inChina)
  const totalWeight = files.reduce((sum, file) => sum + file.weight, 0)
  let doneWeight = 0

  for (const file of files) {
    const urls = sourceOrder.map((id) => resolveModelFileUrl(id, file.repo, file.remoteFile))
    await withMirrorFallback(urls, signal, `${bundle.id}/${file.key}`, (url) =>
      writeBundleFile(file, url, path.join(installDir, file.relPath), signal, (fraction) =>
        onProgress?.((doneWeight + file.weight * fraction) / totalWeight)
      )
    )
    doneWeight += file.weight
    onProgress?.(doneWeight / totalWeight)
  }
}

async function writeBundleFile(
  file: BundleFile,
  url: string,
  dest: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void
): Promise<void> {
  const { derivation, sha256 } = file
  if (!derivation) {
    await streamToFileVerified(url, dest, { sha256, signal, onProgress })
    return
  }
  // Derived files are small configs whose bytes are rewritten before they land, so
  // streaming them to disk would only write something that is not the artifact.
  const fetched = await fetchTextVerified(url, { sha256, signal })
  await writeFileAtomic(dest, applyDerivation(derivation, fetched))
  onProgress(1)
}
