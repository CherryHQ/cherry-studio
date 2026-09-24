import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type * as fsPromises from 'node:fs/promises'
import type { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  realpath: vi.fn(),
  originalRealpath: undefined as typeof realpath | undefined
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
  fsMocks.originalRealpath = actual.realpath
  fsMocks.realpath.mockImplementation((...args: Parameters<typeof actual.realpath>) => actual.realpath(...args))
  return { ...actual, realpath: fsMocks.realpath }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { resolveOutsideManagedStorageEntryMutations, resolveOutsideManagedStorageMutation } =
  await import('../managedStorageGuard')

describe('managed storage mutation path resolution', () => {
  let root: string
  let managedRoot: string

  beforeEach(async () => {
    fsMocks.realpath.mockImplementation((...args: Parameters<typeof realpath>) => fsMocks.originalRealpath!(...args))
    root = await mkdtemp(path.join(tmpdir(), 'cherry-managed-storage-guard-'))
    managedRoot = path.join(root, 'Data', 'Files')
    await mkdir(managedRoot, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'feature.files.data') return managedRoot
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects the managed root, descendants, and ancestor directories', async () => {
    await expect(resolveOutsideManagedStorageMutation(managedRoot)).rejects.toThrow(/overlaps FileManager-owned/)
    await expect(resolveOutsideManagedStorageMutation(path.join(managedRoot, 'entry.bin'))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
    await expect(resolveOutsideManagedStorageMutation(path.dirname(managedRoot))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
  })

  it('rejects either side of a move when one path overlaps managed storage', async () => {
    const outside = path.join(root, 'Notes', 'note.md')
    await expect(
      resolveOutsideManagedStorageEntryMutations(outside, path.join(managedRoot, 'entry.md'))
    ).rejects.toThrow(/overlaps FileManager-owned/)
    await expect(
      resolveOutsideManagedStorageEntryMutations(path.join(managedRoot, 'entry.md'), outside)
    ).rejects.toThrow(/overlaps FileManager-owned/)
  })

  it('rejects an existing symlink and a not-yet-created child that resolve into managed storage', async () => {
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    const link = path.join(outside, 'managed-link')
    await symlink(managedRoot, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveOutsideManagedStorageMutation(link)).rejects.toThrow(/overlaps FileManager-owned/)
    await expect(resolveOutsideManagedStorageMutation(path.join(link, 'future.bin'))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
  })

  it('still rejects managed storage when its realpath reports EISDIR', async () => {
    const outside = path.join(root, 'outside')
    const link = path.join(outside, 'managed-link')
    await mkdir(outside)
    await symlink(managedRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
    fsMocks.realpath.mockImplementation(async (target, options) => {
      if (path.resolve(String(target)) === managedRoot) {
        throw Object.assign(new Error('realpath returned EISDIR'), { code: 'EISDIR' })
      }
      return fsMocks.originalRealpath!(target, options)
    })

    await expect(resolveOutsideManagedStorageMutation(path.join(link, 'future.bin'))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
  })

  it('allows ordinary Notes, Agent workspace, and export targets', async () => {
    const notes = path.join(root, 'Notes')
    const workspace = path.join(root, 'AgentWorkspace')
    const exportDir = path.join(root, 'Exports')
    await Promise.all([mkdir(notes), mkdir(workspace), mkdir(exportDir)])
    await writeFile(path.join(notes, 'existing.md'), 'note')

    await expect(
      resolveOutsideManagedStorageEntryMutations(
        path.join(notes, 'existing.md'),
        path.join(workspace, 'future.md'),
        path.join(exportDir, 'result.pdf')
      )
    ).resolves.toEqual([
      path.join(notes, 'existing.md'),
      path.join(workspace, 'future.md'),
      path.join(exportDir, 'result.pdf')
    ])
  })

  it('returns the physical path for a target below an external directory link', async () => {
    const notes = path.join(root, 'Notes')
    const link = path.join(root, 'RedirectedNotes')
    await mkdir(notes)
    await symlink(notes, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveOutsideManagedStorageMutation(path.join(link, 'future.md'))).resolves.toBe(
      path.join(notes, 'future.md')
    )
  })

  it('keeps a final symlink as the directory entry for rename and delete operations', async () => {
    const notes = path.join(root, 'Notes')
    const link = path.join(root, 'NotesLink')
    await mkdir(notes)
    await symlink(notes, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveOutsideManagedStorageEntryMutations(link)).resolves.toEqual([link])
  })

  it('allows an existing temp file when resolving that file would report EISDIR', async () => {
    const tempFile = path.join(root, 'RedirectedTemp', 'screenshot.png')
    await mkdir(path.dirname(tempFile), { recursive: true })
    await writeFile(tempFile, 'image')

    fsMocks.realpath.mockImplementation(async (target, options) => {
      if (path.resolve(String(target)) === tempFile) {
        throw Object.assign(new Error('realpath failed for a regular file'), { code: 'EISDIR' })
      }
      return fsMocks.originalRealpath!(target, options)
    })

    await expect(resolveOutsideManagedStorageMutation(tempFile)).resolves.toBe(tempFile)
  })

  it('allows a new temp file when its existing directory reports EISDIR from realpath', async () => {
    const tempDir = path.join(root, 'RedirectedTemp')
    const tempFile = path.join(tempDir, 'screenshot.png')
    await mkdir(tempDir)

    fsMocks.realpath.mockImplementation(async (target, options) => {
      if (path.resolve(String(target)) === tempDir) {
        throw Object.assign(new Error('realpath failed for a redirected directory'), { code: 'EISDIR' })
      }
      return fsMocks.originalRealpath!(target, options)
    })

    await expect(resolveOutsideManagedStorageMutation(tempFile)).resolves.toBe(tempFile)
  })
})
