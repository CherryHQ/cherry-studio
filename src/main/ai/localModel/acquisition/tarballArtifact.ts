import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import type { ArtifactPlatformFiles, SharedArtifact } from '../catalog/types'
import { currentPlatformKey } from '../catalog/types'
import { streamToFileVerified, withMirrorFallback } from './downloadEngine'
import type { DownloadSourcePreference } from './modelSource'

const logger = loggerService.withContext('sharedArtifactAcquisition')

/**
 * Acquisition of shared native runtimes published as npm packages. The whole tarball is
 * verified against one digest and the current platform's files are extracted from that
 * same verified stream, so nothing inside needs a checksum of its own.
 *
 * npmmirror.com is a byte-identical registry mirror, so mirror order is a reachability
 * choice only — the digest makes it irrelevant which one served the bytes.
 */
const NPM_REGISTRIES = {
  npmjs: 'https://registry.npmjs.org',
  npmmirror: 'https://registry.npmmirror.com'
} as const

export type ArtifactRegistryId = keyof typeof NPM_REGISTRIES

export function artifactRegistryOrder(
  preference: DownloadSourcePreference
): [ArtifactRegistryId, ...ArtifactRegistryId[]] {
  return preference === 'china-first' ? ['npmmirror', 'npmjs'] : ['npmjs', 'npmmirror']
}

/** The platform's files, or undefined where the artifact ships none (see
 * {@link SharedArtifact.platforms}). */
export function artifactPlatformFiles(artifact: SharedArtifact): ArtifactPlatformFiles | undefined {
  return artifact.platforms[currentPlatformKey()]
}

export function isArtifactSupported(artifact: SharedArtifact): boolean {
  return artifactPlatformFiles(artifact) !== undefined
}

function artifactInstallDir(artifact: SharedArtifact, platform: ArtifactPlatformFiles): string {
  return path.join(application.getPath(artifact.installDirKey), platform.installSubdir)
}

/**
 * Absolute path to the artifact's loadable entry file — for onnxruntime-node, what the
 * inference worker exports as `CHERRY_ONNXRUNTIME_BINDING_PATH` before its first lazy
 * require. Returns a path even on an unsupported platform (callers are gated earlier by
 * the bundle's `unsupported` status), so it never has to be null-checked at the use site.
 */
export function artifactEntryPath(artifact: SharedArtifact): string {
  const platform = artifactPlatformFiles(artifact)
  if (!platform) return path.join(application.getPath(artifact.installDirKey), '')
  return path.join(artifactInstallDir(artifact, platform), platform.entryFile)
}

/**
 * Whether the artifact is usable now. `true` on a platform it does not ship for: there is
 * nothing to install there, and reporting "missing" would make bundles offer a download
 * that cannot exist. Those bundles are already `unsupported` via the platform matrix.
 */
export function isArtifactInstalled(artifact: SharedArtifact): boolean {
  const platform = artifactPlatformFiles(artifact)
  if (!platform) return true
  const dir = artifactInstallDir(artifact, platform)
  return [platform.entryFile, ...platform.supportFiles].every((file) => fs.existsSync(path.join(dir, file)))
}

function tarballUrls(artifact: SharedArtifact, registryOrder: readonly ArtifactRegistryId[]): string[] {
  const { packageName, version } = artifact
  return registryOrder.map((id) => `${NPM_REGISTRIES[id]}/${packageName}/-/${packageName}-${version}.tgz`)
}

/**
 * Download and install the artifact for the current platform. Not idempotent by itself —
 * {@link LocalModelStorageService.ensureArtifact} owns the already-installed check and the
 * coalescing of concurrent callers.
 */
export async function installArtifact(
  artifact: SharedArtifact,
  signal: AbortSignal,
  onProgress: ((fraction: number) => void) | undefined,
  registryOrder: readonly [ArtifactRegistryId, ...ArtifactRegistryId[]]
): Promise<void> {
  const platform = artifactPlatformFiles(artifact)
  if (!platform) return // nothing ships for this platform

  const rootDir = application.getPath(artifact.installDirKey)
  const tmpDir = path.join(rootDir, '.tmp')
  await fs.promises.mkdir(tmpDir, { recursive: true })
  const tarballPath = path.join(tmpDir, `${artifact.packageName}-${artifact.version}.tgz`)
  const extractDir = path.join(tmpDir, `extract-${currentPlatformKey()}`)

  try {
    await withMirrorFallback(tarballUrls(artifact, registryOrder), signal, artifact.id, (url) =>
      streamToFileVerified(url, tarballPath, { sha256: artifact.tarballSha256, signal, onProgress })
    )
    signal.throwIfAborted()
    await extractPlatformFiles(tarballPath, extractDir, platform)
    signal.throwIfAborted()
    await installExtractedFiles(extractDir, artifactInstallDir(artifact, platform), platform)
    signal.throwIfAborted()
    logger.info('shared artifact installed', { artifact: artifact.id, platform: currentPlatformKey() })
  } finally {
    // Drop the whole staging dir rather than its contents: a cancelled download would
    // otherwise leave an empty `.tmp` behind.
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
}

/** Extracts only the current platform's files, flattened onto `extractDir` — the prefix
 * depth is exactly what has to be stripped for entries to land as bare filenames. */
async function extractPlatformFiles(
  tarballPath: string,
  extractDir: string,
  platform: ArtifactPlatformFiles
): Promise<void> {
  await fs.promises.mkdir(extractDir, { recursive: true })
  const { extract } = await import('tar')
  const wanted = new Set([platform.entryFile, ...platform.supportFiles])
  await extract({
    file: tarballPath,
    cwd: extractDir,
    strip: platform.tarballPrefix.split('/').filter(Boolean).length,
    filter: (entryPath) => entryPath.startsWith(platform.tarballPrefix) && wanted.has(path.basename(entryPath))
  })
  for (const file of wanted) {
    if (!fs.existsSync(path.join(extractDir, file))) {
      throw new Error(`tarball is missing expected file: ${platform.tarballPrefix}${file}`)
    }
  }
}

/** Moves the verified files into place. The support files land before the entry file, so
 * {@link isArtifactInstalled} can never see a binding whose libraries have not arrived. */
async function installExtractedFiles(
  extractDir: string,
  installDir: string,
  platform: ArtifactPlatformFiles
): Promise<void> {
  await fs.promises.mkdir(installDir, { recursive: true })
  for (const file of [...platform.supportFiles, platform.entryFile]) {
    await fs.promises.rename(path.join(extractDir, file), path.join(installDir, file))
  }
}

/** Deletes every installed copy of the artifact, including other platforms' leftovers. */
export async function removeArtifact(artifact: SharedArtifact): Promise<void> {
  await fs.promises.rm(application.getPath(artifact.installDirKey), { recursive: true, force: true })
}
