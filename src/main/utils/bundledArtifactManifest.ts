import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'

const MANIFEST_SCHEMA_VERSION = 2
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type BundledArtifactCompression = 'none' | 'zstd'

export type BundledArtifactFile = {
  output: string
  archive: string
  compression: BundledArtifactCompression
  archiveSha256: string
  sha256: string
  size: number
  mode: number
}

export type BundledFilesArtifact = {
  kind: 'files'
  version: string
  files: BundledArtifactFile[]
}

export type BundledTreeFile = {
  path: string
  sha256: string
  size: number
  mode: number
}

export type BundledTreeArtifact = {
  kind: 'tree'
  version: string
  compression: 'zstd'
  archive: string
  archiveSha256: string
  sha256: string
  size: number
  entrypoints: string[]
  files: BundledTreeFile[]
}

export type BundledArtifact = BundledFilesArtifact | BundledTreeArtifact

export type BundledArtifactManifest = {
  schemaVersion: 2
  platform: string
  arch: string
  artifacts: Record<string, BundledArtifact>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  return !value.split(/[\\/]/).some((segment) => segment === '' || segment === '.' || segment === '..')
}

function isSafePathSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function isBundledArtifactFile(value: unknown): value is BundledArtifactFile {
  if (!isRecord(value)) return false
  return (
    isSafeRelativePath(value.output) &&
    isSafeRelativePath(value.archive) &&
    (value.compression === 'none' || value.compression === 'zstd') &&
    isSha256(value.archiveSha256) &&
    isSha256(value.sha256) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mode === 'number' &&
    Number.isSafeInteger(value.mode) &&
    value.mode >= 0 &&
    value.mode <= 0o777
  )
}

function isBundledTreeFile(value: unknown): value is BundledTreeFile {
  if (!isRecord(value)) return false
  return (
    isSafeRelativePath(value.path) &&
    isSha256(value.sha256) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.mode === 'number' &&
    Number.isSafeInteger(value.mode) &&
    value.mode >= 0 &&
    value.mode <= 0o777
  )
}

function parseArtifact(name: string, value: unknown): BundledArtifact {
  if (!isRecord(value) || !isSafePathSegment(value.version)) {
    throw new Error(`Invalid bundled artifact '${name}'`)
  }
  if (value.kind === 'files' && Array.isArray(value.files) && value.files.length > 0) {
    if (!value.files.every(isBundledArtifactFile)) throw new Error(`Invalid bundled files artifact '${name}'`)
    const outputs = value.files.map((file) => file.output)
    const archives = value.files.map((file) => file.archive)
    if (new Set(outputs).size !== outputs.length || new Set(archives).size !== archives.length) {
      throw new Error(`Invalid bundled files inventory '${name}'`)
    }
    const sortedOutputs = [...outputs].sort()
    if (sortedOutputs.some((output, index) => index > 0 && output.startsWith(`${sortedOutputs[index - 1]}/`))) {
      throw new Error(`Invalid bundled files inventory '${name}'`)
    }
    return { kind: 'files', version: value.version, files: value.files }
  }
  if (
    value.kind === 'tree' &&
    value.compression === 'zstd' &&
    isSafeRelativePath(value.archive) &&
    isSha256(value.archiveSha256) &&
    isSha256(value.sha256) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    Array.isArray(value.entrypoints) &&
    value.entrypoints.length > 0 &&
    value.entrypoints.every(isSafeRelativePath) &&
    Array.isArray(value.files) &&
    value.files.length > 0 &&
    value.files.every(isBundledTreeFile)
  ) {
    const filePaths = new Set(value.files.map((file) => file.path))
    if (filePaths.size !== value.files.length || !value.entrypoints.every((entrypoint) => filePaths.has(entrypoint))) {
      throw new Error(`Invalid bundled tree inventory '${name}'`)
    }
    return {
      kind: 'tree',
      version: value.version,
      compression: 'zstd',
      archive: value.archive,
      archiveSha256: value.archiveSha256,
      sha256: value.sha256,
      size: value.size,
      entrypoints: value.entrypoints,
      files: value.files
    }
  }
  throw new Error(`Unsupported bundled artifact '${name}'`)
}

export function bundledArtifactPlatformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

export function readBundledArtifactManifest(
  platform: string = process.platform,
  arch: string = process.arch
): BundledArtifactManifest {
  const platformKey = bundledArtifactPlatformKey(platform, arch)
  const manifestPath = path.join(application.getPath('app.root.resources.binaries'), platformKey, 'manifest.json')
  return readBundledArtifactManifestAt(manifestPath, platform, arch)
}

export function readBundledArtifactManifestAt(
  manifestPath: string,
  platform: string = process.platform,
  arch: string = process.arch
): BundledArtifactManifest {
  const platformKey = bundledArtifactPlatformKey(platform, arch)
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read bundled artifact manifest: ${manifestPath}`, { cause: error })
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    value.platform !== platform ||
    value.arch !== arch ||
    !isRecord(value.artifacts)
  ) {
    throw new Error(`Invalid bundled artifact manifest for ${platformKey}`)
  }

  const artifacts = Object.fromEntries(
    Object.entries(value.artifacts).map(([name, artifact]) => [name, parseArtifact(name, artifact)])
  )
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, platform, arch, artifacts }
}

export function bundledArtifactArchivePath(
  manifest: BundledArtifactManifest,
  archive: string,
  archiveRoot?: string
): string {
  return path.join(
    archiveRoot ??
      path.join(
        application.getPath('app.root.resources.binaries'),
        bundledArtifactPlatformKey(manifest.platform, manifest.arch)
      ),
    archive
  )
}
