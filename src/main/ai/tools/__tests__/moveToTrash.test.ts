import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getProtectedTrashTargetReason, moveWorkspaceItemToTrash } from '../moveToTrash'

describe('moveWorkspaceItemToTrash', () => {
  const tempDirectories: string[] = []

  async function createTempDirectory(prefix: string): Promise<string> {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await mkdir(tempRoot, { recursive: true })
    const directory = await mkdtemp(path.join(tempRoot, prefix))
    tempDirectories.push(directory)
    return directory
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shell.trashItem).mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('moves a regular workspace file through the operating-system trash API', async () => {
    const workspace = await createTempDirectory('move-to-trash-workspace-')
    const target = path.join(workspace, 'draft.txt')
    await writeFile(target, 'draft')

    await expect(
      moveWorkspaceItemToTrash(workspace, { path: 'draft.txt' }, new AbortController().signal)
    ).resolves.toEqual({
      path: 'draft.txt',
      type: 'file',
      destination: 'trash'
    })

    expect(shell.trashItem).toHaveBeenCalledOnce()
    expect(shell.trashItem).toHaveBeenCalledWith(target)
  })

  it('refuses to trash the session workspace root', async () => {
    const workspace = await createTempDirectory('move-to-trash-root-')

    await expect(moveWorkspaceItemToTrash(workspace, { path: '.' }, new AbortController().signal)).rejects.toThrow(
      'session workspace root'
    )
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('refuses paths outside the workspace and symbolic links', async () => {
    const workspace = await createTempDirectory('move-to-trash-symlink-')
    const outside = await createTempDirectory('move-to-trash-outside-')
    const outsideFile = path.join(outside, 'keep.txt')
    const insideFile = path.join(workspace, 'inside.txt')
    await writeFile(outsideFile, 'keep')
    await writeFile(insideFile, 'inside')
    await symlink(outsideFile, path.join(workspace, 'linked.txt'))
    await symlink(insideFile, path.join(workspace, 'inside-link.txt'))

    await expect(
      moveWorkspaceItemToTrash(workspace, { path: '../outside.txt' }, new AbortController().signal)
    ).rejects.toThrow('outside the configured workspace root')
    await expect(
      moveWorkspaceItemToTrash(workspace, { path: 'linked.txt' }, new AbortController().signal)
    ).rejects.toThrow('outside the configured workspace root')
    await expect(
      moveWorkspaceItemToTrash(workspace, { path: 'inside-link.txt' }, new AbortController().signal)
    ).rejects.toThrow('symbolic link')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('honors cancellation before invoking the trash API', async () => {
    const workspace = await createTempDirectory('move-to-trash-abort-')
    await writeFile(path.join(workspace, 'keep.txt'), 'keep')
    const controller = new AbortController()
    controller.abort()

    await expect(moveWorkspaceItemToTrash(workspace, { path: 'keep.txt' }, controller.signal)).rejects.toThrow()
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('protects Windows drive, system, profile, and credential paths', () => {
    const context = {
      platform: 'win32' as const,
      homeDirectory: 'C:\\Users\\alice',
      downloadsDirectory: 'C:\\Users\\alice\\Downloads',
      protectedDirectories: ['C:\\Users\\alice\\AppData\\Roaming\\CherryStudio'],
      environment: {
        SystemRoot: 'C:\\Windows',
        ProgramFiles: 'C:\\Program Files',
        ProgramData: 'C:\\ProgramData'
      }
    }

    expect(getProtectedTrashTargetReason('C:\\', 'C:\\work', context)).toContain('root')
    expect(getProtectedTrashTargetReason('C:\\Windows\\System32', 'C:\\', context)).toContain('operating-system')
    expect(getProtectedTrashTargetReason('C:\\Users\\alice', 'C:\\', context)).toContain('profile')
    expect(getProtectedTrashTargetReason('C:\\Users\\alice\\Documents', 'C:\\', context)).toContain('user data')
    expect(getProtectedTrashTargetReason('C:\\Users\\alice\\.ssh\\id_ed25519', 'C:\\', context)).toContain('credential')
    expect(
      getProtectedTrashTargetReason(
        'C:\\Users\\alice\\Projects\\demo\\nested\\.GIT\\config',
        'C:\\Users\\alice\\Projects\\demo',
        context
      )
    ).toContain('version-control')
    expect(getProtectedTrashTargetReason('C:\\Users\\alice\\OneDrive', 'C:\\Users\\alice', context)).toContain(
      'workspace rooted at or above'
    )
    expect(getProtectedTrashTargetReason('C:\\Users\\alice\\OneDrive', 'C:\\Users', context)).toContain(
      'workspace rooted at or above'
    )
    expect(
      getProtectedTrashTargetReason(
        'C:\\Users\\alice\\Projects\\demo\\draft.txt',
        'C:\\Users\\alice\\Projects',
        context
      )
    ).toBeUndefined()
  })

  it('protects Unix system, application-data, and version-control paths', () => {
    const context = {
      platform: 'darwin' as const,
      homeDirectory: '/Users/alice',
      downloadsDirectory: '/Users/alice/Downloads',
      protectedDirectories: ['/Users/alice/.cherrystudio']
    }

    expect(getProtectedTrashTargetReason('/System/Library/CoreServices', '/System', context)).toContain(
      'operating-system'
    )
    expect(
      getProtectedTrashTargetReason('/Users/alice/Library/Application Support', '/Users/alice', context)
    ).toContain('application-data')
    expect(
      getProtectedTrashTargetReason('/Users/alice/project/.git/config', '/Users/alice/project', context)
    ).toContain('version-control')
    expect(
      getProtectedTrashTargetReason('/Users/alice/project/packages/demo/.git/config', '/Users/alice/project', context)
    ).toContain('version-control')
    expect(
      getProtectedTrashTargetReason('/Users/alice/project/vendor/repo/.hg/store', '/Users/alice/project', context)
    ).toContain('version-control')
    expect(
      getProtectedTrashTargetReason('/Users/alice/project/legacy/.svn/wc.db', '/Users/alice/project', context)
    ).toContain('version-control')
    expect(getProtectedTrashTargetReason('/Volumes/Backup', '/', context)).toContain('volume root')
    expect(
      getProtectedTrashTargetReason('/Users/alice/project/output.txt', '/Users/alice/project', context)
    ).toBeUndefined()
  })
})
