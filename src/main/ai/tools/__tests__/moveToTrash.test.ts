import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

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
      getProtectedTrashTargetReason('/Users/alice/Library/Keychains/login.keychain', '/Users/alice', context)
    ).toContain('credential')
    expect(
      getProtectedTrashTargetReason(
        '/Users/alice/Library/Application Support/CherryStudio/Data/cherrystudio.sqlite',
        '/Users/alice',
        { ...context, applicationDataDirectory: '/Users/alice/Library/Application Support/CherryStudio' }
      )
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

  it('allows macOS workspace content under ~/Library while keeping Library secrets protected', () => {
    const workspace = '/Users/alice/Library/Application Support/CherryStudio-Shared-Workspaces/w-default'
    const context = {
      platform: 'darwin' as const,
      homeDirectory: '/Users/alice',
      applicationDataDirectory: '/Users/alice/Library/Application Support/CherryStudio'
    }

    expect(getProtectedTrashTargetReason(`${workspace}/tasks/run/tmp.txt`, workspace, context)).toBeUndefined()
    expect(getProtectedTrashTargetReason(workspace, workspace, context)).toBe('the session workspace root')
    expect(getProtectedTrashTargetReason('/Users/alice/.ssh/id_rsa', workspace, context)).toContain('credential')
    expect(
      getProtectedTrashTargetReason(
        '/Users/alice/Library/Application Support/CherryStudio/Data/cherrystudio.sqlite',
        workspace,
        context
      )
    ).toContain('application-data')
    expect(
      getProtectedTrashTargetReason('/Users/alice/Library/Keychains/login.keychain', workspace, context)
    ).toContain('credential')
  })

  it('refuses a target that contains the protected directories, not just one inside them', () => {
    const workspace = '/Users/alice/Library'
    const context = {
      platform: 'darwin' as const,
      homeDirectory: '/Users/alice',
      applicationDataDirectory: '/Users/alice/Library/Application Support/CherryStudio'
    }

    expect(getProtectedTrashTargetReason('/Users/alice/Library/Application Support', workspace, context)).toContain(
      'application-data'
    )
    expect(getProtectedTrashTargetReason('/Users/alice/Library/Keychains', workspace, context)).toContain('credential')
    expect(getProtectedTrashTargetReason('/Users/alice/Library', workspace, context)).toBe('the session workspace root')
    expect(getProtectedTrashTargetReason('/Users/alice/Library/MyStuff', workspace, context)).toBeUndefined()
  })

  it('protects paths reached through a `..`-prefixed child or a macOS case variant', () => {
    const darwin = { platform: 'darwin' as const, homeDirectory: '/Users/alice' }

    expect(getProtectedTrashTargetReason('/usr/..x/foo', '/', darwin)).toContain('operating-system')
    expect(getProtectedTrashTargetReason('/Users/alice/.ssh/..x', '/Users/alice/work', darwin)).toContain('credential')
    expect(getProtectedTrashTargetReason('/Volumes/..x', '/', darwin)).toContain('volume root')
    expect(getProtectedTrashTargetReason('/USR/bin', '/', darwin)).toContain('operating-system')
    expect(getProtectedTrashTargetReason('/Users/alice/LIBRARY/Preferences', '/Users/alice/work', darwin)).toContain(
      'application-data'
    )
    expect(getProtectedTrashTargetReason('/Users/alice/DESKTOP', '/Users/alice/work', darwin)).toContain('user data')
    expect(
      getProtectedTrashTargetReason('/Users/alice/work/..x/notes.txt', '/Users/alice/work', darwin)
    ).toBeUndefined()

    expect(getProtectedTrashTargetReason('/USR/bin', '/', { platform: 'linux' as const })).toBeUndefined()
    expect(
      getProtectedTrashTargetReason('C:\\Windows\\..x\\file.dll', 'C:\\', { platform: 'win32' as const })
    ).toContain('operating-system')
  })

  const windowsHome = 'C:\\Users\\lana'
  const windowsAppData = `${windowsHome}\\AppData\\Roaming\\CherryStudio`
  const managedRoot = `${windowsAppData}\\Data\\Agents\\system`
  const dateBucket = `${managedRoot}\\2026-10-15`
  const windowsWorkspace = `${dateBucket}\\cc137f0e-91eb-4ea0-b7ab-0ed00c0fc71b`
  const windowsContext = {
    platform: 'win32' as const,
    homeDirectory: windowsHome,
    applicationDataDirectory: windowsAppData,
    protectedDirectories: [`${windowsHome}\\.cherrystudio`],
    workspaceType: 'system' as const
  }

  it.each(['draft.txt', '_待删', '..draft', 'nested\\draft.txt'])(
    'allows SYSTEM workspace content protected by both application-data ancestors: %s',
    (child) => {
      expect(
        getProtectedTrashTargetReason(`${windowsWorkspace}\\${child}`, windowsWorkspace, windowsContext)
      ).toBeUndefined()
    }
  )

  it('exempts each broad Windows application-data ancestor independently', () => {
    const target = `${windowsWorkspace}\\draft.txt`
    expect(
      getProtectedTrashTargetReason(target, windowsWorkspace, {
        ...windowsContext,
        applicationDataDirectory: undefined
      })
    ).toBeUndefined()
    expect(
      getProtectedTrashTargetReason(target, windowsWorkspace, { ...windowsContext, homeDirectory: undefined })
    ).toBeUndefined()
  })

  it('allows mixed-case Windows SYSTEM workspace children', () => {
    expect(
      getProtectedTrashTargetReason(`${windowsWorkspace.toUpperCase()}\\DRAFT.txt`, windowsWorkspace, windowsContext)
    ).toBeUndefined()
  })

  it.each([
    ['darwin', '/Users/lana', 'Library/Application Support'],
    ['linux', '/home/lana', '.config'],
    ['linux', '/home/lana', '.local/share']
  ] as const)('allows SYSTEM content under %s home container %s/%s', (platform, homeDirectory, container) => {
    const applicationDataDirectory = `${homeDirectory}/${container}/CherryStudio`
    const workspace = `${applicationDataDirectory}/Data/Agents/system/2026-10-15/session`
    expect(
      getProtectedTrashTargetReason(`${workspace}/draft.txt`, workspace, {
        platform,
        homeDirectory,
        applicationDataDirectory,
        protectedDirectories: [`${homeDirectory}/.cherrystudio`],
        workspaceType: 'system'
      })
    ).toBeUndefined()
  })

  it.each([
    [windowsAppData, `${windowsAppData}\\Data\\cherrystudio.sqlite`],
    [managedRoot, `${windowsWorkspace}\\draft.txt`],
    [dateBucket, `${windowsWorkspace}\\draft.txt`],
    [`${windowsWorkspace}.archiving`, `${windowsWorkspace}.archiving\\draft.txt`]
  ])('does not exempt USER workspace %s', (workspace, target) => {
    expect(getProtectedTrashTargetReason(target, workspace, { ...windowsContext, workspaceType: 'user' })).toBe(
      'a credential, configuration, or application-data directory'
    )
  })

  it('does not exempt a workspace without a trusted type', () => {
    expect(
      getProtectedTrashTargetReason(`${windowsWorkspace}\\draft.txt`, windowsWorkspace, {
        ...windowsContext,
        workspaceType: undefined
      })
    ).toBe('a credential, configuration, or application-data directory')
  })

  it('keeps SYSTEM workspace roots and version-control metadata protected', () => {
    expect(getProtectedTrashTargetReason(windowsWorkspace, windowsWorkspace, windowsContext)).toBe(
      'the session workspace root'
    )
    expect(getProtectedTrashTargetReason(`${windowsWorkspace}\\.git\\config`, windowsWorkspace, windowsContext)).toBe(
      'version-control metadata'
    )
  })

  it.each(['.ssh', '.cherrystudio'])('keeps SYSTEM storage under %s protected', (directory) => {
    const workspace = `${windowsHome}\\${directory}\\Data\\Agents\\system\\2026-10-15\\session`
    expect(getProtectedTrashTargetReason(`${workspace}\\draft.txt`, workspace, windowsContext)).toBe(
      'a credential, configuration, or application-data directory'
    )
  })

  it.each([
    `${windowsWorkspace.replace('C:', 'D:')}\\draft.txt`,
    `${managedRoot}-other\\2026-10-15\\session\\draft.txt`,
    `${windowsWorkspace}\\..\\draft.txt`
  ])('does not exempt a target outside the exact SYSTEM workspace: %s', (target) => {
    expect(
      getProtectedTrashTargetReason(target, windowsWorkspace, {
        ...windowsContext,
        applicationDataDirectory: target.startsWith('D:') ? windowsAppData.replace('C:', 'D:') : windowsAppData
      })
    ).toBe('a credential, configuration, or application-data directory')
  })

  it('does not fold Darwin case when granting SYSTEM containment', () => {
    const applicationDataDirectory = '/Users/lana/Library/Application Support/CherryStudio'
    const workspace = `${applicationDataDirectory}/Data/Agents/system/2026-10-15/session`
    expect(
      getProtectedTrashTargetReason(`${workspace.toUpperCase()}/draft.txt`, workspace, {
        platform: 'darwin',
        homeDirectory: '/Users/lana',
        applicationDataDirectory,
        workspaceType: 'system'
      })
    ).toBe('a credential, configuration, or application-data directory')
  })

  it('moves a user workspace file stored under ~/Library/Application Support', async () => {
    const fixture = await createTempDirectory('move-to-trash-shared-')
    const home = path.join(fixture, 'home')
    const workspace = path.join(home, 'Library', 'Application Support', 'CherryStudio-Shared-Workspaces', 'w-default')
    const target = path.join(workspace, 'tasks', 'tmp.txt')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'draft')
    const originalGetPath = vi.mocked(application.getPath).getMockImplementation()!
    const getPath = vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      switch (key) {
        case 'sys.home':
          return home
        case 'sys.downloads':
          return path.join(home, 'Downloads')
        case 'cherry.home':
          return path.join(home, '.cherrystudio')
        case 'app.userdata':
          return path.join(home, 'Library', 'Application Support', 'CherryStudio')
        default:
          return originalGetPath(key, filename)
      }
    })

    try {
      await expect(
        moveWorkspaceItemToTrash(workspace, { path: 'tasks/tmp.txt' }, new AbortController().signal)
      ).resolves.toEqual({ path: 'tasks/tmp.txt', type: 'file', destination: 'trash' })
      expect(shell.trashItem).toHaveBeenCalledWith(target)
    } finally {
      getPath.mockRestore()
    }
  })

  it('moves real managed workspace files and directories with runtime application-data protection', async () => {
    const fixture = await createTempDirectory('move-to-trash-managed-')
    const home = path.join(fixture, 'home')
    const container = process.platform === 'win32' ? 'AppData' : process.platform === 'darwin' ? 'Library' : '.config'
    const appData = path.join(home, container, 'CherryStudio')
    const workspace = path.join(appData, 'Data', 'Agents', 'system', '2026-10-15', 'session')
    await mkdir(path.join(workspace, '_待删'), { recursive: true })
    await writeFile(path.join(workspace, 'draft.txt'), 'draft')
    await writeFile(path.join(workspace, '_待删', 'draft.txt'), 'draft')
    const originalGetPath = vi.mocked(application.getPath).getMockImplementation()!
    const getPath = vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      switch (key) {
        case 'sys.home':
          return home
        case 'sys.downloads':
          return path.join(home, 'Downloads')
        case 'cherry.home':
          return path.join(home, '.cherrystudio')
        case 'app.userdata':
          return appData
        default:
          return originalGetPath(key, filename)
      }
    })

    try {
      for (const [target, type] of [
        ['draft.txt', 'file'],
        ['_待删', 'directory']
      ] as const) {
        await expect(
          moveWorkspaceItemToTrash(workspace, { path: target }, new AbortController().signal, 'system')
        ).resolves.toEqual({ path: target, type, destination: 'trash' })
        expect(shell.trashItem).toHaveBeenCalledWith(path.join(workspace, target))
      }
      expect(shell.trashItem).toHaveBeenCalledTimes(2)
    } finally {
      getPath.mockRestore()
    }
  })
})
