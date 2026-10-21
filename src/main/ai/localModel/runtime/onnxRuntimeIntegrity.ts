import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { t } from '@main/i18n'

import { getSharedArtifact } from '../catalog/catalog'
import integrity from '../catalog/onnxRuntimeIntegrity.json'
import { currentPlatformKey } from '../catalog/types'

export interface OnnxRuntimeIntegritySnapshot {
  /** Opaque: the verified file identity tuple; callers only store and pass it back. */
  readonly signature: string
}

export async function verifyOnnxRuntimeIntegrity(
  previous: OnnxRuntimeIntegritySnapshot | undefined,
  signal?: AbortSignal
): Promise<OnnxRuntimeIntegritySnapshot> {
  signal?.throwIfAborted()
  const artifact = getSharedArtifact('onnxruntime-node')
  const platformKey = currentPlatformKey()
  const platform = artifact.platforms[platformKey]
  const directory = application.getPath(artifact.installDirKey, platform?.installSubdir)
  const unavailable = (file: string, cause?: unknown) =>
    new Error(t('local_model.ocr.runtime_unavailable', { version: artifact.version, directory, file }), { cause })
  const mismatch = (file: string) =>
    new Error(t('local_model.ocr.runtime_mismatch', { version: artifact.version, directory, file }))
  const table = (
    integrity.platforms as Record<string, { files: Record<string, { sizeBytes: number; sha256: string }> }>
  )[platformKey]
  if (
    !platform ||
    !table?.files ||
    integrity.artifact !== artifact.id ||
    integrity.version !== artifact.version ||
    integrity.tarballSha256 !== platform.tarballSha256
  ) {
    throw unavailable(platform?.entryFile ?? 'onnxruntime_binding.node')
  }
  const files = [platform.entryFile, ...platform.supportFiles].sort()
  if (files.length !== Object.keys(table.files).length) throw unavailable(platform.entryFile)
  for (const file of files) {
    const expected = table.files[file]
    if (
      !expected ||
      !Number.isSafeInteger(expected.sizeBytes) ||
      expected.sizeBytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(expected.sha256)
    )
      throw unavailable(file)
  }
  const identities = async () => {
    const tuples: (string | number)[][] = []
    for (const file of files) {
      signal?.throwIfAborted()
      const filename = path.join(directory, file)
      let stats
      try {
        stats = await stat(filename, { bigint: true })
      } catch (cause) {
        signal?.throwIfAborted()
        throw unavailable(file, cause)
      }
      if (!stats.isFile()) throw unavailable(file)
      const expected = table.files[file]
      tuples.push([
        filename,
        expected.sizeBytes,
        expected.sha256,
        ...[stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].map(String)
      ])
    }
    return tuples
  }
  const before = await identities()
  const signature = JSON.stringify([
    artifact.id,
    artifact.version,
    integrity.tarballSha256,
    platformKey,
    directory,
    before
  ])
  signal?.throwIfAborted()
  if (previous?.signature === signature) return previous
  for (const [index, file] of files.entries()) {
    if (before[index][5] !== String(table.files[file].sizeBytes)) throw mismatch(file)
  }
  let mismatchedFile: string | undefined
  for (const file of files) {
    signal?.throwIfAborted()
    const expected = table.files[file]
    const hash = createHash('sha256')
    let size = 0
    try {
      for await (const chunk of createReadStream(path.join(directory, file), { signal })) {
        size += chunk.length
        hash.update(chunk)
      }
    } catch (cause) {
      signal?.throwIfAborted()
      throw unavailable(file, cause)
    }
    signal?.throwIfAborted()
    if (size !== expected.sizeBytes || hash.digest('hex') !== expected.sha256) mismatchedFile ??= file
  }
  const after = await identities()
  for (const [index, tuple] of before.entries()) {
    if (JSON.stringify(tuple) !== JSON.stringify(after[index])) throw unavailable(files[index])
  }
  signal?.throwIfAborted()
  if (mismatchedFile) throw mismatch(mismatchedFile)
  return { signature }
}
