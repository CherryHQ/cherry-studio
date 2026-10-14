import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { prepareAtomicCopy, createContentHasher } from '@main/utils/file'
import type { FileEntryId } from '@shared/data/types/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import type { FileManagerDeps } from '../deps'

export type PublishFileIntakeParams = {
  entryId: FileEntryId
  filename: string
  byteLength: number
  sha256: string
  path: AbsoluteFilePath
}

export async function publishIntake(deps: FileManagerDeps, input: PublishFileIntakeParams) {
  return deps.contentWriteLock.runExclusive(input.entryId, async () => {
    const existing = deps.fileEntryService.findById(input.entryId)
    const ext = path.extname(input.filename).slice(1).toLowerCase() || null
    const name = path.basename(input.filename, path.extname(input.filename))
    if (
      existing &&
      (existing.origin !== 'internal' ||
        existing.name !== name ||
        existing.ext !== ext ||
        existing.size !== input.byteLength)
    )
      throw new Error('File intake identity conflict')
    const physical = AbsoluteFilePathSchema.parse(
      application.getPath('feature.files.data', `${input.entryId}${ext ? `.${ext}` : ''}`)
    )
    try {
      await stat(physical)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const prepared = await prepareAtomicCopy(input.path, physical)
      try {
        await prepared.commit()
      } catch (failure) {
        await prepared.abort()
        throw failure
      }
    }
    const sha256 = createHash('sha256')
    const contentHash = createContentHasher()
    let size = 0
    for await (const bytes of createReadStream(physical)) {
      sha256.update(bytes)
      contentHash.update(bytes)
      size += bytes.length
    }
    if (size !== input.byteLength || sha256.digest('hex') !== input.sha256)
      throw new Error('File intake content integrity check failed')
    if (existing) return existing
    return deps.fileEntryService.withWriteTx((tx) => {
      const entry = deps.fileEntryService.createTx(tx, {
        id: input.entryId,
        origin: 'internal',
        name,
        ext,
        size,
        contentHash: contentHash.digest(),
        cleanupPolicy: 'delete_when_unreferenced'
      })
      return entry
    })
  })
}
