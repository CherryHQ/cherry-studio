import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { BaseService } from '@main/core/lifecycle'
import {
  clearNotesMigrationPairsForTests,
  releaseNotesMigrationSession,
  setNotesMigrationBlockedRoots,
  waitForNotesFilesystemMutationsIdle
} from '@main/services/notesRelocation'
import { hashContent } from '@main/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { PreferenceService } from '@main/data/PreferenceService'

import { FileEditService } from '../FileEditService'
import { FileManager } from '../FileManager'
import { runPathMutationExclusive } from '../pathMutationLock'

vi.unmock('@main/data/PreferenceService')

const atomicWriteGate = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined, entered: false }))
vi.mock('@main/utils/file', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@main/utils/file')>()
  return {
    ...mod,
    atomicWriteIfUnchanged: async (...args: Parameters<typeof mod.atomicWriteIfUnchanged>) => {
      atomicWriteGate.entered = true
      await atomicWriteGate.gate
      return mod.atomicWriteIfUnchanged(...args)
    }
  }
})

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
    atomicWriteGate.gate = undefined
    atomicWriteGate.entered = false
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
        expected: snapshot.baseline,
        data: bytes('saved')
      })
    ).toMatchObject({ metadataRecoveryPending: false })
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
          expected: snapshot.baseline,
          data: bytes('saved')
        })
      ).toMatchObject({ metadataRecoveryPending: false })
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
    await expect(
      service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('wrong')
      })
    ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_TARGET_CHANGED })
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
      const outcome = service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('mine')
      })
      await expect(outcome).rejects.toMatchObject({ code: fileErrorCodes.STALE_VERSION })
      expect(await readFile(target, 'utf8')).toBe('disk')
    }
  )

  it('serializes competing entry and path writes to the same address', async () => {
    const { resource, snapshot } = await open()
    const entry = await files.ensureExternalEntry({ externalPath: resource.path, cleanupPolicy: 'manual' })
    const second = await open({ kind: 'entry', entryId: entry.id })
    const outcomes = await Promise.allSettled([
      service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('path') }),
      service.write(owner, { editId: second.resource.editId, expected: second.snapshot.baseline, data: bytes('entry') })
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: fileErrorCodes.STALE_VERSION }) }
    ])
    expect(await readFile(resource.path, 'utf8')).toBe(outcomes[0].status === 'fulfilled' ? 'path' : 'entry')
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
        expected: snapshot.baseline,
        data: bytes('saved')
      })
      await Promise.resolve()
      const renaming = files.rename(entry.id, 'renamed')
      release.resolve()
      const [outcome] = await Promise.all([writing, renaming, lock])
      expect(outcome).toMatchObject({ metadataRecoveryPending: false })
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
    await expect(
      service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('wrong')
      })
    ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_TARGET_CHANGED })
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({
      code: fileErrorCodes.EDIT_TARGET_CHANGED
    })
    expect(await readFile(files.getPhysicalPath(entry.id), 'utf8')).toBe('base')
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects writes from another window', async () => {
    const { resource, snapshot } = await open()
    const input = { editId: resource.editId, expected: snapshot.baseline, data: bytes('saved') }
    await expect(service.write('other-window', input)).rejects.toThrow('unavailable')
    expect(await readFile(resource.path, 'utf8')).toBe('base')
  })

  it('finishes an accepted write before releasing its lease', async () => {
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
      expected: snapshot.baseline,
      data: bytes('saved')
    })
    expect(outcome).toMatchObject({
      metadataRecoveryPending: true,
      baseline: { contentHash: hashContent('saved') }
    })
    expect(await readFile(resource.path, 'utf8')).toBe('saved')
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
      expected: snapshot.baseline,
      data: edited
    })
    expect(outcome).toMatchObject({ baseline: { contentHash: hashContent(edited) } })
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
    await expect(
      service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('mine')
      })
    ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MISSING })
    await expect(readFile(resource.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(resource.path, Buffer.alloc(8 * 1024 * 1024 + 1))
    await expect(service.read(owner, resource.editId)).rejects.toMatchObject({ code: fileErrorCodes.EDIT_UNSUPPORTED })
  })

  describe('notes migration barrier', () => {
    let blockedTarget: string

    beforeEach(async () => {
      blockedTarget = path.join(root, 'migration-target')
      await mkdir(blockedTarget)
      MockApplicationUtils.setService('IpcApiService', { broadcast: vi.fn(), send: vi.fn() })
      // Canonical release classification reads the configured notes root with
      // provenance; default this suite to "source still configured" so a
      // released barrier lifts cleanly.
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => ({ value: root, provenance: 'cache' }))
      })
      // The outer getPath spy maps every app dir to root, which makes root a
      // protected directory for the classifier's allowed-notes-dir check; point
      // the protected probes at subdirs so the temp notes root stays classifiable.
      vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
        const base =
          key === 'feature.files.data'
            ? path.join(root, 'managed')
            : key === 'sys.appdata' || key === 'feature.notes.data'
              ? path.join(root, key === 'sys.appdata' ? 'appdata' : 'default-notes')
              : root
        return filename ? path.join(base, filename) : base
      })
    })

    afterEach(() => {
      releaseNotesMigrationSession()
      clearNotesMigrationPairsForTests()
    })

    it('refuses to open a lease under a blocked notes root', async () => {
      setNotesMigrationBlockedRoots(root, blockedTarget)
      await expect(open()).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MIGRATION_BLOCKED })
    })

    it('refuses a write at the barrier and leaves the on-disk bytes untouched', async () => {
      const { resource, snapshot } = await open()
      setNotesMigrationBlockedRoots(root, blockedTarget)
      await expect(
        service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MIGRATION_BLOCKED })
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('base')
    })

    it('drains an in-flight notes write before committing a plain notes-root flip', async () => {
      // No migration involved: a plain feature.notes.path preference update
      // must wait for the mutation drain, so an in-flight write linearizes
      // BEFORE the flip instead of committing into the retired tree after it.
      const prefs = new PreferenceService()
      await prefs._doInit()
      MockApplicationUtils.setService('PreferenceService', prefs)
      const elsewhere = await mkdtemp(path.join(tmpdir(), 'notes-flip-target-'))
      const gate = Promise.withResolvers<void>()
      atomicWriteGate.gate = gate.promise
      const { resource, snapshot } = await open()

      const writing = service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('in-flight')
      })
      await vi.waitFor(() => expect(atomicWriteGate.entered).toBe(true))

      let flipped = false
      const flipping = prefs.set('feature.notes.path', elsewhere).then(() => {
        flipped = true
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      // The flip must NOT commit while the write holds a notes mutation.
      expect(flipped).toBe(false)
      expect(prefs.get('feature.notes.path')).not.toBe(elsewhere)

      gate.resolve()
      await writing
      await flipping
      expect(flipped).toBe(true)
      expect(prefs.get('feature.notes.path')).toBe(elsewhere)
      // The write linearized before the flip: its bytes are on disk.
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('in-flight')
      await prefs._doDestroy()
    })

    it('counts an in-flight edit write in the pre-barrier drain', async () => {
      const gate = Promise.withResolvers<void>()
      atomicWriteGate.gate = gate.promise
      const { resource, snapshot } = await open()
      const writing = service.write(owner, {
        editId: resource.editId,
        expected: snapshot.baseline,
        data: bytes('in-flight')
      })
      await vi.waitFor(() => expect(atomicWriteGate.entered).toBe(true))
      let drained = false
      void waitForNotesFilesystemMutationsIdle().then(() => {
        drained = true
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      gate.resolve()
      await writing
      await waitForNotesFilesystemMutationsIdle()
      expect(drained).toBe(true)
    })

    it('writes again once the migration session releases', async () => {
      const { resource, snapshot } = await open()
      setNotesMigrationBlockedRoots(root, blockedTarget)
      await expect(
        service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MIGRATION_BLOCKED })
      releaseNotesMigrationSession()
      await service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('dirty')
    })

    it('retires the source root once the release resolves target-active', async () => {
      const { resource, snapshot } = await open()
      setNotesMigrationBlockedRoots(root, blockedTarget)
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => ({ value: blockedTarget, provenance: 'cache' }))
      })
      releaseNotesMigrationSession()
      await expect(
        service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_RETIRED_ROOT })
      await expect(open()).rejects.toMatchObject({ code: fileErrorCodes.EDIT_RETIRED_ROOT })
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('base')
    })

    it('keeps entry-kind external refs under a retired root openable', async () => {
      const files = application.get('FileManager') as FileManager
      const target = path.join(root, 'external.md')
      await writeFile(target, 'external')
      const entry = await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
      setNotesMigrationBlockedRoots(root, blockedTarget)
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => ({ value: blockedTarget, provenance: 'cache' }))
      })
      releaseNotesMigrationSession()
      const { resource, snapshot } = await open({ kind: 'entry', entryId: entry.id })
      expect(Buffer.from(snapshot.data).toString()).toBe('external')
      await service.close(owner, resource.editId)
    })

    it('retires the source when the preference flip lands after a source-active release', async () => {
      const preference = { read: { value: root, provenance: 'cache' } }
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => preference.read)
      })
      const { resource, snapshot } = await open()
      setNotesMigrationBlockedRoots(root, blockedTarget)
      releaseNotesMigrationSession()
      // The barrier lifted source-active; a write lands while source is current.
      await service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })

      // The renderer's flip arrives late: the very next write to the old root
      // must refuse instead of silently orphaning into the retired copy.
      preference.read = { value: blockedTarget, provenance: 'cache' }
      const afterLateFlip = await service.read(owner, resource.editId)
      await expect(
        service.write(owner, { editId: resource.editId, expected: afterLateFlip.baseline, data: bytes('later') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_RETIRED_ROOT })
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('dirty')
    })

    it('accepts edits again once an unresolved release resolves source-active', async () => {
      const preference = { read: { value: '', provenance: 'not-ready' } }
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => preference.read)
      })
      const { resource, snapshot } = await open()
      setNotesMigrationBlockedRoots(root, blockedTarget)
      releaseNotesMigrationSession()
      await expect(
        service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_ROOT_UNRESOLVED })

      // Recovery by reopen once the canonical root resolves: the draft was
      // never silently written and the root accepts edits again.
      preference.read = { value: root, provenance: 'cache' }
      const reopened = await service.read(owner, resource.editId)
      await service.write(owner, { editId: resource.editId, expected: reopened.baseline, data: bytes('dirty') })
      await expect(readFile(resource.path, 'utf-8')).resolves.toBe('dirty')
    })

    it('closes loud under both roots when the release cannot resolve the configured root', async () => {
      const { resource, snapshot } = await open()
      const orphanPath = path.join(blockedTarget, 'orphan.md')
      await writeFile(orphanPath, 'orphan')
      setNotesMigrationBlockedRoots(root, blockedTarget)
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => ({ value: '', provenance: 'not-ready' }))
      })
      releaseNotesMigrationSession()
      // Unresolved is NOT a retirement: its own honest code, no "moved" claim.
      await expect(
        service.write(owner, { editId: resource.editId, expected: snapshot.baseline, data: bytes('dirty') })
      ).rejects.toMatchObject({ code: fileErrorCodes.EDIT_ROOT_UNRESOLVED })
      await expect(open({ kind: 'path', path: AbsoluteFilePathSchema.parse(orphanPath) })).rejects.toMatchObject({
        code: fileErrorCodes.EDIT_ROOT_UNRESOLVED
      })
    })
  })
})
