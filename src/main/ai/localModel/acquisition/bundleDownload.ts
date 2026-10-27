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

  // The caller hands the files in catalog order, which is the order they must be written
  // in: the frontend files first, the weights last. An interrupted attempt therefore
  // leaves the bundle plainly incomplete, which is what lets the next download fill in
  // the gaps instead of reporting a complete install that cannot load.
  for (const group of downloadGroups(files, bundle.parallelFetchFrom)) {
    await Promise.all(
      group.map(async (file) => {
        const urls = file.urls
          ? orderDownloadUrls(file.urls, sourceOrder[0] === 'modelscope' ? 'china-first' : 'global-first')
          : file.sources
            ? sourceOrder.flatMap((id) =>
                file.sources
                  .filter((source) => source.source === id)
                  .map((source) => resolveModelFileUrl(id, source.repo, source.remoteFile, source.revision))
              )
            : sourceOrder.map((id) => resolveModelFileUrl(id, file.repo, file.remoteFile))
        await withMirrorFallback(urls, signal, `${bundle.id}/${file.key}`, (url) =>
          writeBundleFile(file, url, path.join(installDir, file.relPath), signal, (fraction) =>
            onProgress?.((doneWeight + file.weight * fraction) / totalWeight)
          )
        )
      })
    )
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
  if (!isIndependent(files[start])) {
    // parallelFrom points to a non-independent file (e.g., a weight) — no parallel section
    return files.map((file) => [file])
  }

  const rest = files.slice(start)
  const runLength = rest.findIndex((file) => !isIndependent(file))
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

/** Kokoro's bundle: the lexicons and eSpeak data are independent of one another. */
function isIndependent(file: BundleFile): boolean {
  return INDEPENDENT_FILE_PREFIXES.some((prefix) => file.key.startsWith(prefix))
}

const INDEPENDENT_FILE_PREFIXES: readonly string[] = ['lexicon-', 'espeak-ng-data/']
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
