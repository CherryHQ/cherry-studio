import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { BaseService } from '@main/core/lifecycle'
import { FileEntryIdSchema } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileIntakeService } from '../FileIntakeService'
import { FileManager } from '../FileManager'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

describe('managed file intake publication', () => {
  const database = setupTestDatabase()
  let root: string
  let manager: FileManager

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'file-intake-'))
    await mkdir(path.join(root, 'files'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      path.join(
        root,
        key === 'feature.files.intakes' ? 'intakes' : key === 'feature.files.data' ? 'files' : key,
        filename ?? ''
      )
    )
    BaseService.resetInstances()
    manager = new FileManager()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  async function source(bytes = Buffer.from('original attachment')) {
    const file = AbsoluteFilePathSchema.parse(path.join(root, 'incoming.txt'))
    await writeFile(file, bytes)
    return {
      entryId: FileEntryIdSchema.parse(randomUUID()),
      owner: 'phone/grant',
      filename: '报告.txt',
      path: file,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expiresAt: Date.now() + 60_000
    }
  }

  it('publishes one retained original before any message and replays after source removal', async () => {
    const input = await source()
    const [first, second] = await Promise.all([manager.publishIntake(input), manager.publishIntake(input)])
    expect(first.id).toBe(second.id)
    expect(await readFile(manager.getPhysicalPath(first.id), 'utf8')).toBe('original attachment')
    expect(fileRefService.findByEntryId(first.id)).toEqual([])
    await rm(input.path)
    BaseService.resetInstances()
    manager = new FileManager()
    expect((await manager.publishIntake(input)).id).toBe(first.id)
    expect(fileRefService.countByEntryIds([first.id]).get(first.id) ?? 0).toBe(0)
    expect(await readFile(manager.getPhysicalPath(first.id), 'utf8')).toBe('original attachment')
  })

  it('recovers bytes published before the database transaction without another file identity', async () => {
    const input = await source()
    const reservation = { entryId: input.entryId }
    const failure = vi.spyOn(fileEntryService, 'createTx').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(manager.publishIntake(input)).rejects.toThrow('database unavailable')
    expect(fileEntryService.findById(reservation.entryId)).toBeNull()
    failure.mockRestore()
    await rm(input.path)
    BaseService.resetInstances()
    manager = new FileManager()
    const entry = await manager.publishIntake(input)
    expect(entry.id).toBe(reservation.entryId)
    expect(await readFile(manager.getPhysicalPath(entry.id), 'utf8')).toBe('original attachment')
    expect(fileRefService.countByEntryIds([entry.id]).get(entry.id) ?? 0).toBe(0)
  })

  it('protects aged entries from checkpoint recovery before the first cleanup, then releases expired holds', async () => {
    const input = await source()
    const entry = await manager.publishIntake(input)
    const upload = {
      uploadId: 'upload',
      ownerId: 'phone/grant',
      quotaKey: 'phone',
      filename: input.filename,
      mediaType: 'text/plain',
      byteLength: input.byteLength,
      offset: input.byteLength,
      epoch: 0,
      state: 'ready' as const,
      entryId: entry.id,
      sha256: input.sha256,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000
    }
    await mkdir(manager.intakes.directory(upload), { recursive: true })
    await manager.intakes.save(upload)
    database.db.run(sql`UPDATE file_entry SET created_at = 0, updated_at = 0`)
    BaseService.resetInstances()
    manager = new FileManager()
    await manager.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    await manager.intakes.save({ ...upload, expiresAt: Date.now() - 1 })
    await manager.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
  })

  it('defers cleanup when a checkpoint cannot be read instead of treating files as unowned', async () => {
    const entry = await manager.publishIntake(await source())
    database.db.run(sql`UPDATE file_entry SET created_at = 0, updated_at = 0`)
    const directory = path.join(root, 'intakes', 'a'.repeat(64))
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'state.json'), '{broken')
    await manager.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    expect(await readFile(manager.getPhysicalPath(entry.id), 'utf8')).toBe('original attachment')
  })

  it('keeps a pinned send alive through cancellation and releases it only after the callback finishes', async () => {
    const input = await source()
    const entry = await manager.publishIntake(input)
    const upload = {
      uploadId: 'send',
      ownerId: 'phone',
      quotaKey: 'phone',
      filename: input.filename,
      mediaType: 'text/plain',
      byteLength: input.byteLength,
      offset: input.byteLength,
      epoch: 0,
      state: 'ready' as const,
      entryId: entry.id,
      sha256: input.sha256,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000
    }
    await mkdir(manager.intakes.directory(upload), { recursive: true })
    await manager.intakes.save(upload)
    Object.assign(application.get('FileManager'), { intakes: manager.intakes })
    vi.mocked(application.get('FileManager').getById).mockImplementation((id) => manager.getById(id))
    const intake = new FileIntakeService()
    database.db.run(sql`UPDATE file_entry SET created_at = 0, updated_at = 0`)
    await intake.withEntries(upload, [{ uploadId: 'send' }], async ([file]) => {
      await intake.cancel(upload, 'send')
      await manager.runEntryCleanup()
      expect(file.entryId).toBe(entry.id)
      expect(await readFile(manager.getPhysicalPath(entry.id), 'utf8')).toBe('original attachment')
    })
    await expect(intake.withEntries(upload, [{ uploadId: 'send' }], async () => {})).rejects.toThrow('not found')
    await manager.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await intake.drain()
  })

  it('rejects corrupt bytes before exposing a FileEntry', async () => {
    const input = await source()
    const reservation = { entryId: input.entryId }
    await writeFile(input.path, 'corrupt')
    await expect(manager.publishIntake(input)).rejects.toThrow('integrity')
    expect(fileEntryService.findById(reservation.entryId)).toBeNull()
    expect(fileRefService.countByEntryIds([reservation.entryId]).get(reservation.entryId) ?? 0).toBe(0)
  })
})
