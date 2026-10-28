import path from 'node:path'

import type { BundleFile, ModelBundle } from '../catalog/types'
import { applyDerivation } from './derivations'
import { fetchTextVerified, streamToFileVerified, withMirrorFallback, writeFileAtomic } from './downloadEngine'
import { type ModelSourceId, orderDownloadUrls, resolveModelFileUrl } from './modelSource'

/**
 * Fetching a bundle: one mirror decision for the whole run, one weighted progress bar
 * across the files that are actually missing, and each file verified before it lands.
 */

export interface BundleDownloadOptions {
  sourceOrder: readonly [ModelSourceId, ...ModelSourceId[]]
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
 * The source order is fixed for the run, so files cannot disagree about which mirror to
 * try first.
 */
export async function downloadBundleFiles(
  bundle: ModelBundle,
  files: readonly BundleFile[],
  options: BundleDownloadOptions
): Promise<void> {
  const { sourceOrder, signal, installDir, onProgress } = options
  const totalWeight = files.reduce((sum, file) => sum + file.weight, 0)
  let doneWeight = 0

  const downloadOne = (file: BundleFile, fileSignal: AbortSignal, onFileProgress: (fraction: number) => void) => {
    const urls = file.urls
      ? orderDownloadUrls(file.urls, sourceOrder[0] === 'modelscope' ? 'china-first' : 'global-first')
      : file.sources
        ? sourceOrder.flatMap((id) =>
            file.sources
              .filter((source) => source.source === id)
              .map((source) => resolveModelFileUrl(id, source.repo, source.remoteFile, source.revision))
          )
        : sourceOrder.map((id) => resolveModelFileUrl(id, file.repo, file.remoteFile))
    return withMirrorFallback(urls, fileSignal, `${bundle.id}/${file.key}`, (url) =>
      writeBundleFile(file, url, path.join(installDir, file.relPath), fileSignal, onFileProgress)
    )
  }

  // The caller hands the files in catalog order, which is the order they must be written
  // in: the frontend files first, the weights last. An interrupted attempt therefore
  // leaves the bundle plainly incomplete, which is what lets the next download fill in
  // the gaps instead of reporting a complete install that cannot load.
  for (const group of downloadGroups(files, bundle.parallelFetchFrom)) {
    if (group.length === 1) {
      const file = group[0]
      await downloadOne(file, signal, (fraction) => onProgress?.((doneWeight + file.weight * fraction) / totalWeight))
    } else {
      // A concurrent wave gets one scoped signal: the first failure aborts the siblings,
      // and the wave is not done until every sibling has actually settled. No write or
      // progress report may outlive this promise — the caller tears its attempt down as
      // soon as it rejects, and a still-streaming sibling could otherwise recreate a
      // directory a removal has just deleted.
      const waveAbort = new AbortController()
      const waveSignal = AbortSignal.any([signal, waveAbort.signal])
      const fractions = group.map(() => 0)
      const reportWave = () =>
        onProgress?.(
          (doneWeight + group.reduce((sum, file, index) => sum + file.weight * fractions[index], 0)) / totalWeight
        )
      const results = await Promise.allSettled(
        group.map((file, index) =>
          downloadOne(file, waveSignal, (fraction) => {
            fractions[index] = fraction
            reportWave()
          }).catch((error: unknown) => {
            waveAbort.abort(error)
            throw error
          })
        )
      )
      const failure = results.find((result) => result.status === 'rejected')
      if (failure) throw failure.reason
    }
    doneWeight += group.reduce((sum, file) => sum + file.weight, 0)
    onProgress?.(doneWeight / totalWeight)
  }
}

/**
 * `files`, in order, split into the waves that may run at once. `parallelFrom` is where
 * the independent files start: from there they share waves of up to
 * {@link DOWNLOAD_CONCURRENCY}, and everything else — the files the model needs first as
 * well as the weights — is fetched alone.
 */
function downloadGroups(files: readonly BundleFile[], parallelFrom: number | undefined): BundleFile[][] {
  if (parallelFrom === undefined) return files.map((file) => [file])

  const start = parallelFrom
  if (!files[start]?.independent) {
    // parallelFrom points to a non-independent file (e.g., a weight) — no parallel section
    return files.map((file) => [file])
  }

  const rest = files.slice(start)
  const runLength = rest.findIndex((file) => !file.independent)
  const independent = new Set(runLength < 0 ? rest : rest.slice(0, runLength))

  const groups: BundleFile[][] = []
  for (const file of files) {
    const current = groups.at(-1)
    if (
      independent.has(file) &&
      current?.length &&
      current.length < DOWNLOAD_CONCURRENCY &&
      independent.has(current[0])
    )
      current.push(file)
    else groups.push([file])
  }
  return groups
}

/** Two small lexicons for Kokoro; 8 is safe because files are small (<1MB each) and from the same host. */
const DOWNLOAD_CONCURRENCY = 8

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
  signal.throwIfAborted()
  await writeFileAtomic(dest, applyDerivation(derivation, fetched))
  signal.throwIfAborted()
  onProgress(1)
}
