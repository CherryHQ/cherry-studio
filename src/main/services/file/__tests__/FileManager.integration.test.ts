import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { BaseService } from '@main/core/lifecycle'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('../FileManager')

describe('FileManager (integration)', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-int-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    fm = new FileManager()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('INT-1: end-to-end internal entry read', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff01' as FileEntryId
    const physicalPath = path.join(internalRoot, `${id}.txt`)
    await writeFile(physicalPath, 'internal-payload', 'utf-8')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'note',
      ext: 'txt',
      size: 'internal-payload'.length,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const entry = await fm.getById(id)
    expect(entry.id).toBe(id)
    expect(entry.origin).toBe('internal')

    const result = await fm.read(id)
    expect(result.content).toBe('internal-payload')
    expect(result.mime).toBe('text/plain')
    expect(result.version.size).toBe('internal-payload'.length)

    const meta = await fm.getMetadata(id)
    expect(meta.kind).toBe('file')
    expect(meta.size).toBe('internal-payload'.length)

    const url = await fm.getUrl(id)
    expect(url).toMatch(/^file:\/\//)
    expect(url).toContain(encodeURIComponent(`${id}.txt`).replace(/%2F/g, '/'))
  })

  it('INT-2: external entry canonicalization end-to-end (case-sensitive byte match)', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff02' as FileEntryId
    const file = path.join(tmp, 'doc.pdf')
    await writeFile(file, '%PDF-1.4')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'doc',
      ext: 'pdf',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    // Canonical lookup
    const found = await fm.findByExternalPath(`${file}/`) // trailing slash → canonicalize strips
    expect(found?.id).toBe(id)

    // NFC re-normalization survives a synthesized NFD form
    const nfdFile = file.normalize('NFD')
    const foundNfc = await fm.findByExternalPath(nfdFile)
    expect(foundNfc?.id).toBe(id)

    // Content hash works for external entries
    const hash = await fm.getContentHash(id)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('INT-3: missing-file ENOENT propagates from read', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff03' as FileEntryId
    const file = path.join(tmp, 'gone.txt')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'gone',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    await expect(fm.read(id)).rejects.toThrow(/ENOENT/)
  })

  it('write methods throw notImplemented (deferred to 1b.2)', async () => {
    await expect(fm.createInternalEntry({} as never)).rejects.toThrow(/Phase 1b\.2/)
    await expect(fm.write('x' as FileEntryId, 'y')).rejects.toThrow(/Phase 1b\.2/)
    await expect(fm.trash('x' as FileEntryId)).rejects.toThrow(/Phase 1b\.2/)
  })
})
