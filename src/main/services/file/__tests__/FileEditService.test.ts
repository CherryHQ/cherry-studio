import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { BaseService } from '@main/core/lifecycle'
import { hashContent } from '@main/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditService } from '../FileEditService'
import { FileManager } from '../FileManager'
import { runPathMutationExclusive } from '../pathMutationLock'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('FileEditService persistence contract', () => {
  setupTestDatabase()
  let root: string
  let service: FileEditService
  let files: FileManager
  let handles: string[]
  const owner = 'editing-window'

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'file-edit-'))
    await mkdir(path.join(root, 'managed'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = key === 'feature.files.data' ? path.join(root, 'managed') : root
      return filename ? path.join(base, filename) : base
    })
    BaseService.resetInstances()
    files = new FileManager()
    MockApplicationUtils.setService('FileManager', files)
    service = new FileEditService()
    await service._doInit()
    handles = []
  })

  afterEach(async () => {
    await Promise.all(handles.map((id) => service.close(owner, id)))
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  async function open(handle?: FileHandle) {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'note.md'))
    if (!handle) await writeFile(target, 'base')
    const resource = await service.open(owner, handle ?? { kind: 'path', path: target })
    handles.push(resource.editId)
    return {
      resource: {
        ...resource,
        path: handle?.kind === 'entry' ? files.getPhysicalPath(handle.entryId) : (handle?.path ?? target)
      },
      snapshot: await service.read(owner, resource.editId)
    }
  }

  it('reads and saves through symlink-parent traversal without touching the lexical sibling', async () => {
    await mkdir(path.join(root, 'a'))
    await mkdir(path.join(root, 'other', 'dir'), { recursive: true })
    await symlink(path.join(root, 'other', 'dir'), path.join(root, 'a', 'link'), 'junction')
    const intended = path.join(root, 'other', 'note.md')
    const sibling = path.join(root, 'a', 'note.md')
    await writeFile(intended, 'intended')
    await writeFile(sibling, 'sibling')
    const target = AbsoluteFilePathSchema.parse(`${root}/a/link/../note.md`)
    const { resource, snapshot } = await open({ kind: 'path', path: target })
    expect(new TextDecoder().decode(snapshot.data)).toBe('intended')
    expect(
      await service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('saved')
      })
    ).toMatchObject({ kind: 'committed' })
    expect(await readFile(intended, 'utf8')).toBe('saved')
    expect(await readFile(sibling, 'utf8')).toBe('sibling')
  })

  it.each(['path', 'entry'] as const)(
    'edits a final symlink through a %s handle without replacing the link',
    async (kind) => {
      const target = path.join(root, 'target.md')
      const link = AbsoluteFilePathSchema.parse(path.join(root, 'link.md'))
      await writeFile(target, 'base')
      await symlink(target, link)
      const entry =
        kind === 'entry' ? await files.ensureExternalEntry({ externalPath: link, cleanupPolicy: 'manual' }) : undefined
      const { resource, snapshot } = await open(
        entry ? { kind: 'entry', entryId: entry.id } : { kind: 'path', path: link }
      )
      expect(
        await service.write(owner, {
          editId: resource.editId,
          sequence: 1,
          expected: snapshot.baseline,
          data: bytes('saved')
        })
      ).toMatchObject({ kind: 'committed' })
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('saved')
    }
  )

  it('rejects a retargeted symlink even when the replacement has identical content', async () => {
    const link = AbsoluteFilePathSchema.parse(path.join(root, 'link.md'))
    const first = path.join(root, 'first.md')
    const second = path.join(root, 'second.md')
    await writeFile(first, 'base')
    await writeFile(second, 'base')
    await symlink(first, link)
    const { resource, snapshot } = await open({ kind: 'path', path: link })
    await rm(link)
    await symlink(second, link)
    expect(
      await service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('wrong')
      })
    ).toMatchObject({ kind: 'not-committed', code: fileErrorCodes.EDIT_TARGET_CHANGED })
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({
      code: fileErrorCodes.EDIT_TARGET_CHANGED
    })
    expect(await readFile(first, 'utf8')).toBe('base')
    expect(await readFile(second, 'utf8')).toBe('base')
  })

  it('denies managed storage reached through symlink-parent traversal', async () => {
    await mkdir(path.join(root, 'managed', 'child'))
    await symlink(path.join(root, 'managed', 'child'), path.join(root, 'link'), 'junction')
    await writeFile(path.join(root, 'managed', 'secret.md'), 'protected')
    await writeFile(path.join(root, 'secret.md'), 'decoy')
    await expect(
      open({ kind: 'path', path: AbsoluteFilePathSchema.parse(`${root}/link/../secret.md`) })
    ).rejects.toThrow()
    expect(await readFile(path.join(root, 'managed', 'secret.md'), 'utf8')).toBe('protected')
  })

  it('rejects an unfinished acquisition when the file service stops', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'first.md'))
    await writeFile(target, 'base')
    const opening = service.open(owner, { kind: 'path', path: target })
    const rejected = expect(opening).rejects.toMatchObject({ code: fileErrorCodes.EDIT_LEASE_CLOSED })
    await service._doStop()
    await rejected
    await expect(service.open(owner, { kind: 'path', path: target })).rejects.toMatchObject({
      code: fileErrorCodes.EDIT_LEASE_CLOSED
    })
    expect(await readFile(target, 'utf8')).toBe('base')
  })

  it.each(['path', 'entry'] as const)(
    'binds %s bytes to hashes and rejects equal-size preserved-timestamp changes',
    async (kind) => {
      const target = AbsoluteFilePathSchema.parse(path.join(root, 'note.md'))
      await writeFile(target, 'base')
      await utimes(target, 1700000000.123, 1700000000.123)
      const entry =
        kind === 'entry'
          ? await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
          : undefined
      const { resource, snapshot } = await open(
        entry ? { kind: 'entry', entryId: entry.id } : { kind: 'path', path: target }
      )
      expect(snapshot.baseline.contentHash).toBe(hashContent(snapshot.data))
      expect(new TextDecoder().decode(snapshot.data)).toBe('base')
      await writeFile(target, 'disk')
      await utimes(target, 1700000000.123, 1700000000.123)
      const outcome = await service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('mine')
      })
      expect(outcome).toEqual({ kind: 'not-committed', sequence: 1, code: fileErrorCodes.STALE_VERSION })
      expect(await readFile(target, 'utf8')).toBe('disk')
    }
  )

  it('serializes competing entry and path writes to the same address', async () => {
    const { resource, snapshot } = await open()
    const entry = await files.ensureExternalEntry({ externalPath: resource.path, cleanupPolicy: 'manual' })
    const second = await open({ kind: 'entry', entryId: entry.id })
    const outcomes = await Promise.all([
      service.write(owner, { editId: resource.editId, sequence: 1, expected: snapshot.baseline, data: bytes('path') }),
      service.write(owner, {
        editId: second.resource.editId,
        sequence: 1,
        expected: second.snapshot.baseline,
        data: bytes('entry')
      })
    ])
    expect(outcomes.filter((outcome) => outcome.kind === 'committed')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.kind === 'not-committed')).toEqual([
      { kind: 'not-committed', sequence: 1, code: fileErrorCodes.STALE_VERSION }
    ])
    expect(await readFile(resource.path, 'utf8')).toBe(outcomes[0].kind === 'committed' ? 'path' : 'entry')
  })

  it('keeps an accepted entry write on its source while rename waits', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'source.md'))
    await writeFile(target, 'base')
    const entry = await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
    const { resource, snapshot } = await open({ kind: 'entry', entryId: entry.id })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const lock = runPathMutationExclusive(async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      const writing = service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('saved')
      })
      await Promise.resolve()
      const renaming = files.rename(entry.id, 'renamed')
      release.resolve()
      const [outcome] = await Promise.all([writing, renaming, lock])
      expect(outcome).toMatchObject({ kind: 'committed' })
      expect(await readFile(files.getPhysicalPath(entry.id), 'utf8')).toBe('saved')
      await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      release.resolve()
      await lock
    }
  })

  it('rejects an entry that was rebound after its lease opened', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'source.md'))
    await writeFile(target, 'base')
    const entry = await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
    const { resource, snapshot } = await open({ kind: 'entry', entryId: entry.id })
    await files.rename(entry.id, 'renamed')
    expect(
      await service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('wrong')
      })
    ).toMatchObject({ kind: 'not-committed', code: fileErrorCodes.EDIT_TARGET_CHANGED })
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({
      code: fileErrorCodes.EDIT_TARGET_CHANGED
    })
    expect(await readFile(files.getPhysicalPath(entry.id), 'utf8')).toBe('base')
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns a lost receipt without replaying bytes over a subsequent external edit', async () => {
    const { resource, snapshot } = await open()
    const input = { editId: resource.editId, sequence: 1, expected: snapshot.baseline, data: bytes('saved') }
    const receipt = await service.write(owner, input)
    expect(receipt).toMatchObject({ kind: 'committed', baseline: { contentHash: hashContent(input.data) } })
    await writeFile(resource.path, 'external')
    expect(await service.settleWrite(owner, resource.editId, 1)).toEqual(receipt)
    expect(await service.write(owner, input)).toEqual(receipt)
    expect(await readFile(resource.path, 'utf8')).toBe('external')
  })

  it('fences a write overtaken by settlement and permits only the next sequence', async () => {
    const { resource, snapshot } = await open()
    const input = { editId: resource.editId, sequence: 1, expected: snapshot.baseline, data: bytes('late') }
    expect(await service.settleWrite(owner, resource.editId, 1)).toEqual({ kind: 'not-started', sequence: 1 })
    expect(await service.write(owner, input)).toEqual({ kind: 'not-started', sequence: 1 })
    expect(await readFile(resource.path, 'utf8')).toBe('base')
    expect(await service.write(owner, { ...input, sequence: 2 })).toMatchObject({ kind: 'committed', sequence: 2 })
    expect(await readFile(resource.path, 'utf8')).toBe('late')
    expect(() => service.write(owner, input)).toThrow('sequence')
  })

  it('rejects changed duplicate payloads and writes from another window', async () => {
    const { resource, snapshot } = await open()
    const input = { editId: resource.editId, sequence: 1, expected: snapshot.baseline, data: bytes('saved') }
    expect(() => service.write('other-window', input)).toThrow('unavailable')
    await service.write(owner, input)
    expect(() => service.write(owner, { ...input, data: bytes('other') })).toThrow('sequence')
    expect(await readFile(resource.path, 'utf8')).toBe('saved')
  })

  it('settles an accepted write before releasing its lease', async () => {
    const { resource, snapshot } = await open()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const lock = runPathMutationExclusive(async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      const write = service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('saved')
      })
      const closing = service.close(owner, resource.editId)
      await expect(service.read(owner, resource.editId)).rejects.toMatchObject({
        code: fileErrorCodes.EDIT_LEASE_CLOSED
      })
      expect(await readFile(resource.path, 'utf8')).toBe('base')
      release.resolve()
      await Promise.all([lock, closing, write])
      expect(await readFile(resource.path, 'utf8')).toBe('saved')
      expect(() => service.settleWrite(owner, resource.editId, 1)).toThrow('unavailable')
    } finally {
      release.resolve()
      await lock
    }
  })

  it('reports committed metadata failure without classifying it as a failed byte write', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: bytes('base'),
      name: 'note',
      ext: 'md',
      cleanupPolicy: 'manual'
    })
    const { resource, snapshot } = await open({ kind: 'entry', entryId: entry.id })
    vi.spyOn(fileEntryService, 'completeInternalContentCommit').mockImplementationOnce(() => {
      throw new Error('metadata unavailable')
    })
    const outcome = await service.write(owner, {
      editId: resource.editId,
      sequence: 1,
      expected: snapshot.baseline,
      data: bytes('saved')
    })
    expect(outcome).toMatchObject({
      kind: 'committed',
      metadataRecoveryPending: true,
      baseline: { contentHash: hashContent('saved') }
    })
    expect(await readFile(resource.path, 'utf8')).toBe('saved')
    expect(await service.settleWrite(owner, resource.editId, 1)).toEqual(outcome)
    expect(fileEntryService.getById(entry.id)).toMatchObject({ contentHash: null })
  })

  it.each(['path', 'entry'] as const)('edits and reopens an 8 MiB %s file without losing bytes', async (kind) => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'large.md'))
    const original = Buffer.alloc(8 * 1024 * 1024, 'a')
    await writeFile(target, original)
    const entry =
      kind === 'entry' ? await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' }) : undefined
    const handle: FileHandle = entry ? { kind: 'entry', entryId: entry.id } : { kind: 'path', path: target }
    const { resource, snapshot } = await open(handle)
    expect(Buffer.from(snapshot.data).equals(original)).toBe(true)
    expect(snapshot.baseline.contentHash).toBe(hashContent(original))

    const edited = Buffer.from(original)
    edited.write('edited', edited.length - 6)
    const outcome = await service.write(owner, {
      editId: resource.editId,
      sequence: 1,
      expected: snapshot.baseline,
      data: edited
    })
    expect(outcome).toMatchObject({ kind: 'committed', baseline: { contentHash: hashContent(edited) } })
    await service.close(owner, resource.editId)
    expect((await readFile(target)).equals(edited)).toBe(true)
    const reopened = await open(handle)
    expect(Buffer.from(reopened.snapshot.data).equals(edited)).toBe(true)
    expect(reopened.snapshot.baseline.contentHash).toBe(hashContent(edited))
  })

  it('does not create a missing file or return an editable empty oversized snapshot', async () => {
    const { resource, snapshot } = await open()
    await rm(resource.path)
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MISSING })
    expect(
      await service.write(owner, {
        editId: resource.editId,
        sequence: 1,
        expected: snapshot.baseline,
        data: bytes('mine')
      })
    ).toMatchObject({ kind: 'not-committed', code: fileErrorCodes.EDIT_MISSING })
    await expect(readFile(resource.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(resource.path, Buffer.alloc(8 * 1024 * 1024 + 1))
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({ code: fileErrorCodes.EDIT_UNSUPPORTED })
  })
})
