import type * as NodeFs from 'node:fs'

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { externalAppRequestSchemas } from '@shared/ipc/schemas/externalApp'

const mocks = vi.hoisted(() => ({
  getApplicationInfoForProtocol: vi.fn(),
  isSafeExternalUrl: vi.fn(),
  openExternal: vi.fn(),
  listNativeApplications: vi.fn(),
  openNativeApplication: vi.fn(),
  safeOpen: vi.fn(),
  showInFolder: vi.fn(),
  statSync: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getApplicationInfoForProtocol: mocks.getApplicationInfoForProtocol,
    getFileIcon: async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,cA==' })
  },
  nativeImage: {
    createFromPath: () => ({
      resize: () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,cA==' })
    })
  },
  shell: { openExternal: mocks.openExternal }
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  statSync: mocks.statSync
}))
vi.mock('@main/services/file', () => ({ safeOpen: mocks.safeOpen, showInFolder: mocks.showInFolder }))
vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: mocks.isSafeExternalUrl }))
vi.mock('../nativeApplication', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeApplicationModule>()),
  listNativeApplications: mocks.listNativeApplications,
  openNativeApplication: mocks.openNativeApplication
}))

import { ExternalAppService } from '../ExternalAppService'
import { nativeTargetId } from '../nativeApplication'
import type * as NativeApplicationModule from '../nativeApplication'

const preview = { id: '/Applications/Preview.app', name: 'Preview', iconPath: '/Applications/Preview.app' }
const editor = { id: '/Applications/TextEdit.app', name: 'TextEdit' }

describe('ExternalAppService', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    vi.clearAllMocks()
    mocks.statSync.mockReturnValue({ isDirectory: () => false })
    mocks.isSafeExternalUrl.mockReturnValue(true)
    mocks.listNativeApplications.mockResolvedValue({ applications: [preview, editor], defaultApplication: preview })
    mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => {
      if (protocol === 'vscode://') return { name: 'Visual Studio Code', path: '/Applications/Code.app' }
      throw new Error('not installed')
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['darwin', 'win32', 'linux'])(
    'lists associated applications and presents the default once on %s',
    async (platform) => {
      vi.stubGlobal('process', Object.defineProperty(Object.create(process), 'platform', { value: platform }))
      const result = await new ExternalAppService().listOpenTargets('/tmp/report.pdf')
      expect(result).toEqual({
        pathKind: 'file',
        recommendedTargetId: 'system_default',
        targets: [
          { id: 'system_default', kind: 'system_default', name: 'Preview', iconDataUrl: 'data:image/png;base64,cA==' },
          { id: 'file_manager', kind: 'file_manager' },
          { id: nativeTargetId(editor.id), kind: 'application', name: 'TextEdit', iconDataUrl: undefined }
        ]
      })
      expect(externalAppRequestSchemas['external_app.target.list'].output.parse(result)).toEqual(result)
      expect(JSON.stringify(result)).not.toContain('/Applications/')
    }
  )

  it('deduplicates identical identities but keeps different installations with the same display name', async () => {
    const other = { ...editor, id: '/Other/TextEdit.app' }
    mocks.listNativeApplications.mockResolvedValue({ applications: [editor, editor, other], defaultApplication: null })
    const result = await new ExternalAppService().listOpenTargets('/tmp/a.txt')
    expect(result.targets.filter((item) => item.kind === 'application').map((item) => item.id)).toEqual([
      nativeTargetId(editor.id),
      nativeTargetId(other.id)
    ])
  })

  it('preserves native application icons instead of replacing them with generic file icons', async () => {
    const defaultIcon = 'data:image/png;base64,ZGVmYXVsdA=='
    const editorIcon = 'data:image/png;base64,ZWRpdG9y'
    const defaultApplication = { ...preview, iconDataUrl: defaultIcon }
    mocks.listNativeApplications.mockResolvedValue({
      applications: [defaultApplication, { ...editor, iconDataUrl: editorIcon }],
      defaultApplication
    })
    const result = await new ExternalAppService().listOpenTargets('/tmp/report.pdf')
    expect(result.targets.find((target) => target.id === 'system_default')?.iconDataUrl).toBe(defaultIcon)
    expect(result.targets.find((target) => target.id === nativeTargetId(editor.id))?.iconDataUrl).toBe(editorIcon)
  })

  it('keeps defaults and application availability specific to each file even with the same extension', async () => {
    mocks.listNativeApplications.mockImplementation(async (file: string) =>
      file.endsWith('a.txt')
        ? { applications: [editor], defaultApplication: editor }
        : { applications: [preview, editor], defaultApplication: preview }
    )
    const service = new ExternalAppService()
    const a = await service.listOpenTargets('/tmp/a.txt')
    const b = await service.listOpenTargets('/tmp/b.txt')
    expect(a.targets[0]?.name).toBe('TextEdit')
    expect(a.targets).toHaveLength(2)
    expect(b.targets[0]?.name).toBe('Preview')
    expect(b.targets).toHaveLength(3)
    expect(await service.listOpenTargets('/tmp/./a.txt')).toEqual(a)
  })

  it('retains default-open and reveal when enumeration fails without inventing compatible applications', async () => {
    mocks.listNativeApplications.mockRejectedValue(new Error('helper missing'))
    const service = new ExternalAppService()
    expect((await service.listOpenTargets('/tmp/a.txt')).targets).toEqual([
      { id: 'system_default', kind: 'system_default' },
      { id: 'file_manager', kind: 'file_manager' }
    ])
    await service.openTarget('/tmp/a.txt', 'system_default')
    await service.openTarget('/tmp/a.txt', 'file_manager')
    expect(mocks.safeOpen).toHaveBeenCalledWith('/tmp/a.txt')
    expect(mocks.showInFolder).toHaveBeenCalledWith('/tmp/a.txt')
  })

  it('opens a discovered application using its private native identity', async () => {
    const service = new ExternalAppService()
    await service.openTarget('/tmp/中文 a.txt', nativeTargetId(editor.id))
    expect(mocks.openNativeApplication).toHaveBeenCalledExactlyOnceWith('/tmp/中文 a.txt', editor.id)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('rejects a removed application despite an existing presentation cache', async () => {
    const service = new ExternalAppService()
    await service.listOpenTargets('/tmp/a.txt')
    mocks.listNativeApplications.mockResolvedValue({ applications: [], defaultApplication: null })
    await expect(service.openTarget('/tmp/a.txt', nativeTargetId(editor.id))).rejects.toThrow('is not available')
    expect(mocks.openNativeApplication).not.toHaveBeenCalled()
  })

  it.each(['native:forged', 'native:/bin/sh', 'unknown', 'known:arbitrary', 'known:wt'])(
    'rejects unavailable file target %s',
    async (targetId) => {
      await expect(new ExternalAppService().openTarget('/tmp/a.txt', targetId)).rejects.toThrow('is not available')
      expect(mocks.openNativeApplication).not.toHaveBeenCalled()
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(mocks.safeOpen).not.toHaveBeenCalled()
    }
  )

  it.each(['js', 'exe', 'dmg'])('keeps %s files restricted to controlled editors and reveal', async (extension) => {
    const service = new ExternalAppService()
    const file = `/tmp/file.${extension}`
    expect(await service.listOpenTargets(file)).toEqual({
      pathKind: 'file',
      recommendedTargetId: 'known:vscode',
      targets: [
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
    await expect(service.openTarget(file, nativeTargetId(editor.id))).rejects.toThrow('is not available')
    await expect(service.openTarget(file, 'system_default')).rejects.toThrow('is not available')
    expect(mocks.listNativeApplications).not.toHaveBeenCalled()
    expect(mocks.openNativeApplication).not.toHaveBeenCalled()
  })

  it('falls back to reveal for dangerous files when no controlled editor is installed', async () => {
    mocks.getApplicationInfoForProtocol.mockRejectedValue(new Error('not installed'))
    expect(await new ExternalAppService().listOpenTargets('/tmp/install.dmg')).toEqual({
      pathKind: 'file',
      recommendedTargetId: 'file_manager',
      targets: [{ id: 'file_manager', kind: 'file_manager' }]
    })
  })

  it('preserves directory editor choices and forbids native file handlers for directories', async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    const service = new ExternalAppService()
    expect(await service.listOpenTargets('/tmp/project')).toEqual({
      pathKind: 'directory',
      recommendedTargetId: 'file_manager',
      targets: [
        { id: 'file_manager', kind: 'file_manager' },
        { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' }
      ]
    })
    await expect(service.openTarget('/tmp/project', nativeTargetId(editor.id))).rejects.toThrow('is not available')
    await service.openTarget('/tmp/My Workspace/开发', 'known:vscode')
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'vscode://file//tmp/My%20Workspace/%E5%BC%80%E5%8F%91?windowId=_blank'
    )
    expect(mocks.listNativeApplications).not.toHaveBeenCalled()
  })

  it('keeps saved controlled editor IDs usable and validates their URLs', async () => {
    const service = new ExternalAppService()
    await service.openTarget('/tmp/README.md', 'known:vscode', 'file')
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith('vscode://file//tmp/README.md?windowId=_blank')
    mocks.isSafeExternalUrl.mockReturnValue(false)
    await expect(service.openTarget('/tmp/a.txt', 'known:vscode')).rejects.toThrow('failed safety validation')
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('honors file context for missing extensionless files', async () => {
    mocks.statSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mocks.listNativeApplications.mockResolvedValue({ applications: [], defaultApplication: null })
    expect((await new ExternalAppService().listOpenTargets('/tmp/Dockerfile', 'file')).pathKind).toBe('file')
  })
})
