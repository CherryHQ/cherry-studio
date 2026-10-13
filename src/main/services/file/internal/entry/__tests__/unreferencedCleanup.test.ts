import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { paintingTable } from '@data/db/schemas/painting'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { createDanglingCacheImpl } from '@main/services/file/danglingCache'
import type { FileManagerDeps } from '@main/services/file/internal/deps'
import { createVersionCacheImpl } from '@main/services/file/versionCache'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createInternal, ensureExternal } from '../create'
import { deleteUnreferencedInternalEntry } from '../lifecycle'

describe('unreferenced internal entry retirement', () => {
  const dbh = setupTestDatabase()
  let root: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-avatar-files-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') return filename ? path.join(root, filename) : root
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: createDanglingCacheImpl(),
      versionCache: createVersionCacheImpl(32),
      contentWriteLock: new KeyedMutex()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('cherry-avatar-files-')) {
      throw new Error('Unexpected temporary file directory')
    }
    await rm(root, { recursive: true, force: true })
  })

  async function createImage() {
    return createInternal(deps, {
      source: 'bytes',
      data: new Uint8Array([1, 2, 3]),
      name: 'image',
      ext: 'webp',
      cleanupPolicy: 'manual'
    })
  }

  it('removes a retired manual entry and its physical image', async () => {
    const entry = await createImage()
    const physical = path.join(root, `${entry.id}.webp`)

    await expect(deleteUnreferencedInternalEntry(deps, entry.id)).resolves.toBe(true)

    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(stat(physical)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the image and a painting reference that still uses it', async () => {
    const entry = await createImage()
    const paintingId = randomUUID()
    dbh.db
      .insert(paintingTable)
      .values({
        id: paintingId,
        providerId: 'provider',
        modelId: null,
        prompt: 'prompt',
        orderKey: paintingId
      })
      .run()
    dbh.db
      .insert(paintingFileRefTable)
      .values({
        id: randomUUID(),
        fileEntryId: entry.id,
        sourceId: paintingId,
        role: 'output'
      })
      .run()

    await expect(deleteUnreferencedInternalEntry(deps, entry.id)).resolves.toBe(false)

    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    expect(dbh.db.select().from(paintingFileRefTable).all()).toHaveLength(1)
    await expect(readFile(path.join(root, `${entry.id}.webp`))).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('preserves external entries and their user-owned files', async () => {
    const physical = path.join(root, 'external.txt')
    await writeFile(physical, 'user file')
    const entry = await ensureExternal(deps, {
      externalPath: AbsoluteFilePathSchema.parse(physical),
      cleanupPolicy: 'manual'
    })

    await expect(deleteUnreferencedInternalEntry(deps, entry.id)).resolves.toBe(false)

    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    await expect(readFile(physical, 'utf8')).resolves.toBe('user file')
  })

  it('treats an already-deleted entry as a no-op', async () => {
    await expect(deleteUnreferencedInternalEntry(deps, randomUUID())).resolves.toBe(false)
  })
})
