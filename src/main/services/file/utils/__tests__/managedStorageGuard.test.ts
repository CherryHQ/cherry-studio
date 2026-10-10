import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { assertOutsideManagedStorageMutation } = await import('../managedStorageGuard')

describe('assertOutsideManagedStorageMutation', () => {
  let root: string
  let managedRoot: string

  beforeEach(async () => {
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
    await expect(assertOutsideManagedStorageMutation(managedRoot)).rejects.toThrow(/overlaps FileManager-owned/)
    await expect(assertOutsideManagedStorageMutation(path.join(managedRoot, 'entry.bin'))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
    await expect(assertOutsideManagedStorageMutation(path.dirname(managedRoot))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
  })

  it('rejects either side of a move when one path overlaps managed storage', async () => {
    const outside = path.join(root, 'Notes', 'note.md')
    await expect(assertOutsideManagedStorageMutation(outside, path.join(managedRoot, 'entry.md'))).rejects.toThrow(
      /overlaps FileManager-owned/
    )
    await expect(assertOutsideManagedStorageMutation(path.join(managedRoot, 'entry.md'), outside)).rejects.toThrow(
      /overlaps FileManager-owned/
    )
  })

  it('rejects an existing symlink and a not-yet-created child that resolve into managed storage', async () => {
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    const link = path.join(outside, 'managed-link')
    await symlink(managedRoot, link, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(assertOutsideManagedStorageMutation(link)).rejects.toThrow(/overlaps FileManager-owned/)
    await expect(assertOutsideManagedStorageMutation(path.join(link, 'future.bin'))).rejects.toThrow(
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
      assertOutsideManagedStorageMutation(
        path.join(notes, 'existing.md'),
        path.join(workspace, 'future.md'),
        path.join(exportDir, 'result.pdf')
      )
    ).resolves.toBeUndefined()
  })
})
