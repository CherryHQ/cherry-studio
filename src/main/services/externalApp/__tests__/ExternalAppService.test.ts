import type * as NodeFs from 'node:fs'

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { externalAppRequestSchemas } from '@shared/ipc/schemas/externalApp'

const mocks = vi.hoisted(() => ({
  getApplicationInfoForProtocol: vi.fn(),
  isSafeExternalUrl: vi.fn(),
  lstatSync: vi.fn(),
  openExternal: vi.fn(),
  platform: { isMac: true, isWin: false, isLinux: false },
  realpath: vi.fn(),
  resolveDefaultApplication: vi.fn(),
  safeOpen: vi.fn(),
  showInFolder: vi.fn(),
  statSync: vi.fn()
}))

vi.mock('@main/core/platform', () => mocks.platform)
vi.mock('@main/utils/file', () => ({ realpath: mocks.realpath }))

vi.mock('electron', () => ({
  app: { getApplicationInfoForProtocol: mocks.getApplicationInfoForProtocol },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  lstatSync: mocks.lstatSync,
  statSync: mocks.statSync
}))

vi.mock('@main/services/file', () => ({
  safeOpen: mocks.safeOpen,
  showInFolder: mocks.showInFolder
}))

vi.mock('@main/utils/externalUrlSafety', () => ({
  isSafeExternalUrl: mocks.isSafeExternalUrl
}))

vi.mock('../defaultApplication', () => ({
  resolveDefaultApplication: mocks.resolveDefaultApplication
}))

describe('ExternalAppService', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    vi.clearAllMocks()
    Object.assign(mocks.platform, { isMac: true, isWin: false, isLinux: false })
    mocks.realpath.mockImplementation(async (applicationPath: string) => applicationPath)
    mocks.statSync.mockReturnValue({ isDirectory: () => false })
    mocks.isSafeExternalUrl.mockReturnValue(true)
    mocks.resolveDefaultApplication.mockResolvedValue(null)
    mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => {
      if (protocol === 'vscode://') return { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' }
      throw new Error('not installed')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('keeps the file manager first and lists every supported directory application', async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => ({
      name: protocol,
      path: `/Applications/${protocol}`
    }))
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/workspace')).resolves.toEqual({
      pathKind: 'directory',
      recommendedTargetId: 'file_manager',
      targets: [
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' },
        { id: 'known:cursor', name: 'Cursor', kind: 'application' },
        { id: 'known:zed', name: 'Zed', kind: 'application' }
      ]
    })
  })

  it('keeps the system-default recommendation when its display metadata is unavailable', async () => {
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/report.pdf')).resolves.toEqual({
      pathKind: 'file',
      recommendedTargetId: 'system_default',
      targets: [
        { id: 'system_default', kind: 'system_default' },
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
  })

  it('enriches the system-default target without duplicating it', async () => {
    mocks.resolveDefaultApplication.mockResolvedValue({
      name: 'Preview',
      iconDataUrl: 'data:image/png;base64,preview'
    })
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/report.pdf')).resolves.toEqual({
      pathKind: 'file',
      recommendedTargetId: 'system_default',
      targets: [
        {
          id: 'system_default',
          name: 'Preview',
          iconDataUrl: 'data:image/png;base64,preview',
          kind: 'system_default'
        },
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
    expect(mocks.resolveDefaultApplication).toHaveBeenCalledWith('/tmp/report.pdf')
  })

  it('keeps the system recommendation while listing every supported application', async () => {
    mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => ({
      name: protocol,
      path: `/Applications/${protocol}`
    }))
    const { ExternalAppService } = await import('../ExternalAppService')

    const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

    expect(result.targets).toEqual([
      { id: 'system_default', kind: 'system_default' },
      { id: 'file_manager', kind: 'file_manager' },
      { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' },
      { id: 'known:cursor', name: 'Cursor', kind: 'application' },
      { id: 'known:zed', name: 'Zed', kind: 'application' }
    ])
    expect(result.recommendedTargetId).toBe('system_default')
  })

  it.each([
    ['/tmp/a.md', '/tmp/b.md'],
    ['/tmp/b.md', '/tmp/a.md']
  ])('keeps per-file defaults and editor availability independent when listing %s before %s', async (first, second) => {
    mocks.resolveDefaultApplication.mockImplementation(async (targetPath: string) =>
      targetPath === '/tmp/a.md'
        ? {
            name: 'Visual Studio Code.app',
            path: '/Applications/Visual Studio Code.app',
            iconDataUrl: 'data:image/png;base64,code'
          }
        : { name: 'Other.app', path: '/Applications/Other.app', iconDataUrl: 'data:image/png;base64,other' }
    )
    const { ExternalAppService } = await import('../ExternalAppService')
    const service = new ExternalAppService()
    const results = new Map([
      [first, await service.listOpenTargets(first)],
      [second, await service.listOpenTargets(second)]
    ])

    expect(results.get('/tmp/a.md')?.targets).toEqual([
      {
        id: 'system_default',
        kind: 'system_default',
        name: 'Visual Studio Code.app',
        iconDataUrl: 'data:image/png;base64,code'
      },
      { id: 'file_manager', kind: 'file_manager' }
    ])
    expect(results.get('/tmp/b.md')?.targets).toEqual([
      {
        id: 'system_default',
        kind: 'system_default',
        name: 'Other.app',
        iconDataUrl: 'data:image/png;base64,other'
      },
      { id: 'file_manager', kind: 'file_manager' },
      { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
    ])
    await service.listOpenTargets('/tmp/./a.md')
    await service.listOpenTargets('/tmp/b.md')
    expect(mocks.resolveDefaultApplication.mock.calls).toEqual([[first], [second]])
  })

  it('shares one directory cache entry without resolving file default metadata', async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    const { ExternalAppService } = await import('../ExternalAppService')
    const service = new ExternalAppService()

    const first = await service.listOpenTargets('/tmp/first')
    const second = await service.listOpenTargets('/tmp/second')

    expect(second).toBe(first)
    expect(second).toEqual({
      pathKind: 'directory',
      recommendedTargetId: 'file_manager',
      targets: [
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
    expect(mocks.resolveDefaultApplication).not.toHaveBeenCalled()
  })

  describe('macOS default application reconciliation', () => {
    beforeEach(() => {
      mocks.resolveDefaultApplication.mockResolvedValue({
        name: '代码编辑器.app',
        path: '/Applications/Default.app',
        iconDataUrl: 'data:image/png;base64,app'
      })
      mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => ({
        name: protocol,
        path: `/Applications/${protocol.split(':')[0]}.app`
      }))
    })

    it('removes only the editor proven to be the default and keeps ordered presentation metadata private', async () => {
      mocks.realpath.mockImplementation(async (applicationPath: string) =>
        applicationPath === '/Applications/cursor.app' ? '/Applications/Default.app' : applicationPath
      )
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result).toEqual({
        pathKind: 'file',
        recommendedTargetId: 'system_default',
        targets: [
          {
            id: 'system_default',
            kind: 'system_default',
            name: '代码编辑器.app',
            iconDataUrl: 'data:image/png;base64,app'
          },
          { id: 'file_manager', kind: 'file_manager' },
          { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' },
          { id: 'known:zed', name: 'Zed', kind: 'application' }
        ]
      })
      expect(externalAppRequestSchemas['external_app.target.list'].output.parse(result)).toEqual(result)
      expect(mocks.realpath.mock.calls.filter(([subject]) => subject === '/Applications/Default.app')).toHaveLength(1)
    })

    it('drops every proven duplicate even when several protocol registrations share the default bundle', async () => {
      mocks.realpath.mockImplementation(async (applicationPath: string) =>
        applicationPath === '/Applications/zed.app' ? applicationPath : '/Applications/Default.app'
      )
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual(['system_default', 'file_manager', 'known:zed'])
      expect(result.recommendedTargetId).toBe('system_default')
    })

    it('keeps different installations with the same display name', async () => {
      mocks.resolveDefaultApplication.mockResolvedValue({ name: 'Visual Studio Code', path: '/Other/Code.app' })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual([
        'system_default',
        'file_manager',
        'known:vscode',
        'known:cursor',
        'known:zed'
      ])
      expect(result.recommendedTargetId).toBe('system_default')
    })

    it('keeps all editors when a matching name has no application identity', async () => {
      mocks.resolveDefaultApplication.mockResolvedValue({ name: 'Visual Studio Code' })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets).toEqual([
        { id: 'system_default', kind: 'system_default', name: 'Visual Studio Code' },
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' },
        { id: 'known:cursor', name: 'Cursor', kind: 'application' },
        { id: 'known:zed', name: 'Zed', kind: 'application' }
      ])
      expect(result.recommendedTargetId).toBe('system_default')
      expect(mocks.realpath).not.toHaveBeenCalled()
    })

    it('retains an editor whose realpath fails while still merging other proven duplicates', async () => {
      mocks.realpath.mockImplementation(async (applicationPath: string) => {
        if (applicationPath === '/Applications/vscode.app') throw new Error('EACCES')
        return '/Applications/Default.app'
      })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual(['system_default', 'file_manager', 'known:vscode'])
    })

    it('retains identical raw paths when resolving the default identity fails', async () => {
      mocks.resolveDefaultApplication.mockResolvedValue({ name: 'Code', path: '/Applications/vscode.app' })
      mocks.realpath.mockRejectedValue(new Error('ENOENT'))
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual([
        'system_default',
        'file_manager',
        'known:vscode',
        'known:cursor',
        'known:zed'
      ])
    })

    it('preserves symlink-before-parent segments until physical resolution', async () => {
      mocks.resolveDefaultApplication.mockResolvedValue({ name: 'Code', path: '/Applications/link/../Code.app' })
      mocks.realpath.mockImplementation(async (applicationPath: string) => {
        if (applicationPath === '/Applications/link/../Code.app' || applicationPath === '/Applications/vscode.app') {
          return '/Volumes/Editors/Code.app'
        }
        return applicationPath
      })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual([
        'system_default',
        'file_manager',
        'known:cursor',
        'known:zed'
      ])
      expect(mocks.realpath).toHaveBeenCalledWith('/Applications/link/../Code.app')
    })

    it.each([
      ['/Applications/code.app', '/Applications/Code.app'],
      ['/Applications/Café.app', '/Applications/Cafe\u0301.app'],
      ['/Applications/Code\\Editor.app', '/Applications/Code/Editor.app']
    ])('does not conflate distinct canonical paths %s and %s', async (defaultPath, editorPath) => {
      mocks.resolveDefaultApplication.mockResolvedValue({ name: 'Code', path: defaultPath })
      mocks.getApplicationInfoForProtocol.mockResolvedValue({ name: 'Code', path: editorPath })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual([
        'system_default',
        'file_manager',
        'known:vscode',
        'known:cursor',
        'known:zed'
      ])
    })

    it.each(['isWin', 'isLinux'] as const)('does not merge identical paths on %s', async (platform) => {
      Object.assign(mocks.platform, { isMac: false, isWin: false, isLinux: false, [platform]: true })
      mocks.getApplicationInfoForProtocol.mockResolvedValue({ name: 'Code', path: '/Applications/Default.app' })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/README.md')

      expect(result.targets.map(({ id }) => id)).toEqual([
        'system_default',
        'file_manager',
        'known:vscode',
        'known:cursor',
        'known:zed'
      ])
      expect(result.recommendedTargetId).toBe('system_default')
      expect(mocks.realpath).not.toHaveBeenCalled()
      expect(result.targets[0]).toEqual({
        id: 'system_default',
        kind: 'system_default',
        name: '代码编辑器.app',
        iconDataUrl: 'data:image/png;base64,app'
      })
    })

    it('never reconciles dangerous files even when every editor would match the default', async () => {
      mocks.getApplicationInfoForProtocol.mockResolvedValue({ name: 'Code', path: '/Applications/Default.app' })
      const { ExternalAppService } = await import('../ExternalAppService')

      const result = await new ExternalAppService().listOpenTargets('/tmp/script.js')

      expect(result.targets.map(({ id }) => id)).toEqual(['file_manager', 'known:vscode', 'known:cursor', 'known:zed'])
      expect(result.recommendedTargetId).toBe('known:vscode')
      expect(mocks.resolveDefaultApplication).not.toHaveBeenCalled()
      expect(mocks.realpath).not.toHaveBeenCalled()
    })

    it('launches a merged-away known editor and dispatches the default through the current OS association', async () => {
      mocks.realpath.mockResolvedValue('/Applications/Default.app')
      const { ExternalAppService } = await import('../ExternalAppService')
      const service = new ExternalAppService()

      const result = await service.listOpenTargets('/tmp/README.md')
      expect(result.targets.map(({ id }) => id)).toEqual(['system_default', 'file_manager'])
      await service.openTarget('/tmp/README.md', 'known:vscode', 'file')
      await service.openTarget('/tmp/README.md', 'system_default', 'file')

      expect(mocks.safeOpen).toHaveBeenCalledWith('/tmp/README.md')
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith('vscode://file//tmp/README.md?windowId=_blank')
    })
  })

  it('removes the system-default action for dangerous files but keeps controlled editors', async () => {
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/script.js')).resolves.toEqual({
      pathKind: 'file',
      recommendedTargetId: 'known:vscode',
      targets: [
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
  })

  it('falls back to the containing directory for dangerous unsupported file types', async () => {
    mocks.getApplicationInfoForProtocol.mockRejectedValue(new Error('not installed'))
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/install.dmg')).resolves.toEqual({
      pathKind: 'file',
      recommendedTargetId: 'file_manager',
      targets: [{ id: 'file_manager', kind: 'file_manager' }]
    })
  })

  it('treats missing extensionless targets as files when the caller has file context', async () => {
    mocks.statSync.mockImplementation(() => {
      throw new Error('not found')
    })
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().listOpenTargets('/tmp/Dockerfile', 'file')).resolves.toEqual({
      pathKind: 'file',
      recommendedTargetId: 'system_default',
      targets: [
        { id: 'system_default', kind: 'system_default' },
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
  })

  it('opens only a fixed target available for the current path kind', async () => {
    const { ExternalAppService } = await import('../ExternalAppService')
    const service = new ExternalAppService()

    await service.openTarget('/tmp/README.md', 'known:vscode', 'file')
    expect(mocks.openExternal).toHaveBeenCalledWith('vscode://file//tmp/README.md?windowId=_blank')
    await expect(service.openTarget('/tmp/report.pdf', 'known:wt', 'file')).rejects.toThrow('is not available')
  })

  it.each(['known:wt', 'known:arbitrary', 'unknown', 'known:cursor'])(
    'rejects unavailable file target %s without launching anything',
    async (targetId) => {
      const { ExternalAppService } = await import('../ExternalAppService')

      await expect(new ExternalAppService().openTarget('/tmp/README.md', targetId, 'file')).rejects.toThrow(
        `Open target "${targetId}" is not available for this path`
      )
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(mocks.safeOpen).not.toHaveBeenCalled()
    }
  )

  it('encodes spaces and non-ASCII directory names in editor URLs', async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    const { ExternalAppService } = await import('../ExternalAppService')

    await new ExternalAppService().openTarget('/tmp/My Workspace/开发', 'known:vscode', 'directory')

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'vscode://file//tmp/My%20Workspace/%E5%BC%80%E5%8F%91?windowId=_blank'
    )
  })

  it('validates generated editor URLs before opening them externally', async () => {
    mocks.isSafeExternalUrl.mockReturnValue(false)
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().openTarget('/tmp/README.md', 'known:vscode', 'file')).rejects.toThrow(
      'failed safety validation'
    )
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
