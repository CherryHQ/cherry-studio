import type * as NodeFs from 'node:fs'

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getApplicationInfoForProtocol: vi.fn(),
  isSafeExternalUrl: vi.fn(),
  lstatSync: vi.fn(),
  openExternal: vi.fn(),
  resolveDefaultApplication: vi.fn(),
  safeOpen: vi.fn(),
  showInFolder: vi.fn(),
  statSync: vi.fn()
}))

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

  it('validates generated editor URLs before opening them externally', async () => {
    mocks.isSafeExternalUrl.mockReturnValue(false)
    const { ExternalAppService } = await import('../ExternalAppService')

    await expect(new ExternalAppService().openTarget('/tmp/README.md', 'known:vscode', 'file')).rejects.toThrow(
      'failed safety validation'
    )
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
