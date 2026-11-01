import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { shell } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'
import { SkillImportError } from '@main/ai/skills/SkillImportError'
import en from '@main/i18n/locales/en-us.json'
import zh from '@main/i18n/locales/zh-cn.json'
import { PluginError } from '@main/utils/markdownParser'

const {
  installMock,
  uninstallMock,
  installFromZipMock,
  installFromDirectoryMock,
  listLocalMock,
  discoverSystemMock,
  getByIdMock,
  getInstalledSkillDirectoryMock,
  importSystemMock,
  reconcileMock,
  reconcileSkillMock,
  checkRemoteUpdateMock,
  applyRemoteUpdateMock
} = vi.hoisted(() => ({
  installMock: vi.fn(),
  uninstallMock: vi.fn(),
  installFromZipMock: vi.fn(),
  installFromDirectoryMock: vi.fn(),
  listLocalMock: vi.fn(),
  discoverSystemMock: vi.fn(),
  getByIdMock: vi.fn(),
  getInstalledSkillDirectoryMock: vi.fn(),
  importSystemMock: vi.fn(),
  reconcileMock: vi.fn(),
  reconcileSkillMock: vi.fn(),
  checkRemoteUpdateMock: vi.fn(),
  applyRemoteUpdateMock: vi.fn()
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  SkillRemoteUpdateError: class SkillRemoteUpdateError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
  skillService: {
    install: installMock,
    uninstall: uninstallMock,
    installFromZip: installFromZipMock,
    installFromDirectory: installFromDirectoryMock,
    listLocal: listLocalMock,
    discoverSystem: discoverSystemMock,
    getById: getByIdMock,
    getInstalledSkillDirectory: getInstalledSkillDirectoryMock,
    importSystem: importSystemMock,
    reconcileSkills: reconcileMock,
    reconcileSkill: reconcileSkillMock,
    checkRemoteUpdate: checkRemoteUpdateMock,
    applyRemoteUpdate: applyRemoteUpdateMock
  }
}))

import { skillHandlers } from '../skill'

const openPathMock = vi.mocked(shell.openPath)
const logger = loggerService.withContext('skillHandlers')

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
})

describe('skillHandlers', () => {
  it('install wraps the installed skill in a success envelope', async () => {
    installMock.mockResolvedValue({ id: 's1' })
    expect(await skillHandlers['skill.install']({ installSource: 'src' }, ctx)).toEqual({
      success: true,
      data: { id: 's1' }
    })
    expect(installMock).toHaveBeenCalledWith({ installSource: 'src' })
  })

  it('install returns a failure envelope (and swallows the throw) on error', async () => {
    installMock.mockRejectedValue(new Error('boom'))
    expect(await skillHandlers['skill.install']({ installSource: 'src' }, ctx)).toEqual({
      success: false,
      error: 'boom'
    })
  })

  it('uninstall forwards the skillId and returns a void success envelope', async () => {
    uninstallMock.mockResolvedValue(undefined)
    expect(await skillHandlers['skill.uninstall']({ skillId: 's1' }, ctx)).toEqual({ success: true, data: undefined })
    expect(uninstallMock).toHaveBeenCalledWith('s1')
  })

  it('install_from_zip / install_from_directory forward their path options', async () => {
    installFromZipMock.mockResolvedValue({ id: 'z' })
    installFromDirectoryMock.mockResolvedValue({ id: 'd' })
    expect(await skillHandlers['skill.install_from_zip']({ zipFilePath: '/a.zip' }, ctx)).toEqual({
      success: true,
      data: { id: 'z' }
    })
    expect(await skillHandlers['skill.install_from_directory']({ directoryPath: '/dir' }, ctx)).toEqual({
      success: true,
      data: { id: 'd' }
    })
    expect(installFromZipMock).toHaveBeenCalledWith({ zipFilePath: '/a.zip' })
    expect(installFromDirectoryMock).toHaveBeenCalledWith({ directoryPath: '/dir' })
  })

  describe.each(['zip', 'directory'] as const)('local %s errors', (kind) => {
    const invoke = () =>
      kind === 'zip'
        ? skillHandlers['skill.install_from_zip']({ zipFilePath: '/tmp/x.zip' }, ctx)
        : skillHandlers['skill.install_from_directory']({ directoryPath: '/tmp/x' }, ctx)
    const mock = kind === 'zip' ? installFromZipMock : installFromDirectoryMock
    const missingKey = kind === 'zip' ? 'skill.import.zip_missing_skill_md' : 'skill.import.directory_missing_skill_md'

    it.each(['zh-CN', 'en-US'] as const)(
      'returns the real %s catalog without paths and logs the original diagnostics',
      async (language) => {
        MockMainPreferenceServiceUtils.setPreferenceValue('app.language', language)
        const catalog = language === 'zh-CN' ? zh : en
        const cases = [
          {
            error: new SkillImportError(
              'SKILL_DIRECTORY_NOT_FOUND',
              'No skill directory found in /tmp/zip-install-123'
            ),
            key: missingKey,
            code: 'SKILL_DIRECTORY_NOT_FOUND',
            targetPath: undefined
          },
          {
            error: new SkillImportError('INVALID_ZIP_FILE', 'Not a ZIP file: /tmp/x.txt'),
            key: 'skill.import.invalid_zip_file',
            code: 'INVALID_ZIP_FILE',
            targetPath: undefined
          },
          {
            error: new SkillImportError('DIRECTORY_NOT_FOUND', 'Directory not found: /tmp/x'),
            key: 'skill.import.directory_not_found',
            code: 'DIRECTORY_NOT_FOUND',
            targetPath: undefined
          },
          {
            error: new PluginError(
              'FILE_NOT_FOUND',
              '/tmp/x/SKILL.md',
              'SKILL.md or skill.md not found in skill folder'
            ),
            key: missingKey,
            code: 'FILE_NOT_FOUND',
            targetPath: '/tmp/x/SKILL.md'
          }
        ] as const
        for (const { error, key, code, targetPath } of cases) {
          const originalMessage = error.message
          mock.mockRejectedValueOnce(error)
          const result = await invoke()
          expect(result).toEqual({ success: false, error: catalog[key] })
          expect(result).toHaveProperty('error', expect.not.stringMatching(/\/tmp\/|zip-install/))
          expect(error.message).toBe(originalMessage)
          expect(logger.error).toHaveBeenLastCalledWith(expect.any(String), { error, failureCode: code, targetPath })
        }
      }
    )

    it.each([
      new Error('EACCES: permission denied, open /tmp/unknown-file'),
      'boom',
      Object.assign(new Error('x'), { code: 'SKILL_DIRECTORY_NOT_FOUND' }),
      { code: 'SKILL_DIRECTORY_NOT_FOUND' }
    ])('preserves an unknown error verbatim: %s', async (error) => {
      mock.mockRejectedValueOnce(error)
      expect(await invoke()).toEqual({ success: false, error: error instanceof Error ? error.message : String(error) })
      expect(logger.error).toHaveBeenLastCalledWith(expect.any(String), error)
    })
  })

  it.each([
    new SkillImportError('SKILL_DIRECTORY_NOT_FOUND', 'No skill directory found in /tmp/zip-install-marketplace'),
    new PluginError('FILE_NOT_FOUND', '/tmp/marketplace/SKILL.md', 'SKILL.md or skill.md not found in skill folder')
  ])('preserves classified marketplace diagnostics: %s', async (error) => {
    installMock.mockRejectedValueOnce(error)
    expect(await skillHandlers['skill.install']({ installSource: 'src' }, ctx)).toEqual({
      success: false,
      error: error.message
    })
    expect(logger.error).toHaveBeenLastCalledWith('Failed to install skill', error)
  })

  it('list_local forwards the workdir', async () => {
    listLocalMock.mockResolvedValue([{ name: 'a', filename: 'a.md' }])
    expect(await skillHandlers['skill.list_local']({ workdir: '/w' }, ctx)).toEqual({
      success: true,
      data: [{ name: 'a', filename: 'a.md' }]
    })
    expect(listLocalMock).toHaveBeenCalledWith('/w')
  })

  it('discover_system returns native IpcApi data without a nested SkillResult envelope', async () => {
    discoverSystemMock.mockResolvedValue([{ id: 'candidate-1' }])

    await expect(skillHandlers['skill.discover_system']({}, ctx)).resolves.toEqual([{ id: 'candidate-1' }])
    expect(discoverSystemMock).toHaveBeenCalledWith()
  })

  it('system skill routes keep discovery and import separate from agent association', async () => {
    discoverSystemMock.mockResolvedValue([])
    importSystemMock.mockResolvedValue({ id: 'system-skill' })

    await skillHandlers['skill.discover_system']({}, ctx)
    await skillHandlers['skill.import_system']({ directoryPath: '/skill' }, ctx)

    expect(discoverSystemMock).toHaveBeenCalledWith()
    expect(importSystemMock).toHaveBeenCalledWith({ directoryPath: '/skill' })
  })

  it('reconcile delegates to SkillService.reconcileSkills with the native IpcApi contract', async () => {
    reconcileMock.mockResolvedValue(undefined)

    await expect(skillHandlers['skill.reconcile']({}, ctx)).resolves.toBeUndefined()
    expect(reconcileMock).toHaveBeenCalledWith()
  })

  it('scopes reconcile to one Skill when skillId is present', async () => {
    reconcileSkillMock.mockResolvedValue(undefined)

    await expect(skillHandlers['skill.reconcile']({ skillId: 's1' }, ctx)).resolves.toBeUndefined()
    expect(reconcileSkillMock).toHaveBeenCalledExactlyOnceWith('s1')
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('forwards remote checks and applies while preserving stable domain error codes', async () => {
    checkRemoteUpdateMock.mockResolvedValue({ state: 'up_to_date', localChanges: false, remoteVersion: '1.0.0' })
    await expect(skillHandlers['skill.remote.check']({ skillId: 's1' }, ctx)).resolves.toEqual({
      state: 'up_to_date',
      localChanges: false,
      remoteVersion: '1.0.0'
    })

    const { SkillRemoteUpdateError } = await import('@main/ai/skills/SkillService')
    applyRemoteUpdateMock.mockRejectedValue(new SkillRemoteUpdateError('SKILL_REMOTE_STALE', 'stale'))
    await expect(
      skillHandlers['skill.remote.apply']({ skillId: 's1', revision: 'revision', overwriteLocalChanges: false }, ctx)
    ).rejects.toMatchObject({ code: 'SKILL_REMOTE_STALE', message: 'stale' })
  })

  it('opens the registered skill directory without accepting a renderer-supplied path', async () => {
    const skill = { id: 's1', folderName: 'safe-skill' }
    getByIdMock.mockResolvedValue(skill)
    getInstalledSkillDirectoryMock.mockReturnValue('/managed/skills/safe-skill')
    openPathMock.mockResolvedValue('')

    await expect(skillHandlers['skill.folder.open']({ skillId: 's1' }, ctx)).resolves.toBeUndefined()

    expect(getByIdMock).toHaveBeenCalledWith('s1')
    expect(getInstalledSkillDirectoryMock).toHaveBeenCalledWith(skill)
    expect(openPathMock).toHaveBeenCalledWith('/managed/skills/safe-skill')
  })

  it('resolves the managed directory and marks only builtin Skills as read-only', async () => {
    getByIdMock
      .mockResolvedValueOnce({ id: 'local', folderName: 'local-skill', source: 'local' })
      .mockResolvedValueOnce({ id: 'builtin', folderName: 'builtin-skill', source: 'builtin' })
    getInstalledSkillDirectoryMock
      .mockReturnValueOnce('/managed/skills/local-skill')
      .mockReturnValueOnce('/managed/skills/builtin-skill')

    await expect(skillHandlers['skill.folder.resolve']({ skillId: 'local' }, ctx)).resolves.toEqual({
      rootPath: '/managed/skills/local-skill',
      access: 'read_write'
    })
    await expect(skillHandlers['skill.folder.resolve']({ skillId: 'builtin' }, ctx)).resolves.toEqual({
      rootPath: '/managed/skills/builtin-skill',
      access: 'read_only',
      readOnlyReason: 'builtin'
    })
  })

  it('does not resolve a folder when the Skill is no longer installed', async () => {
    getByIdMock.mockResolvedValue(null)

    await expect(skillHandlers['skill.folder.resolve']({ skillId: 'missing' }, ctx)).rejects.toThrow(
      'Skill not found: missing'
    )
    expect(getInstalledSkillDirectoryMock).not.toHaveBeenCalled()
  })

  it('does not open a path when the skill is no longer installed', async () => {
    getByIdMock.mockResolvedValue(null)

    await expect(skillHandlers['skill.folder.open']({ skillId: 'missing' }, ctx)).rejects.toThrow(
      'Skill not found: missing'
    )
    expect(openPathMock).not.toHaveBeenCalled()
  })

  it('does not open a skill folder for a trusted but unmanaged renderer', async () => {
    await expect(skillHandlers['skill.folder.open']({ skillId: 's1' }, { senderId: null })).rejects.toThrow(
      'Skill folders can only be opened from a managed window'
    )
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(openPathMock).not.toHaveBeenCalled()
  })

  it('reports the OS error when the managed skill directory cannot be opened', async () => {
    const skill = { id: 's1', folderName: 'missing-directory' }
    getByIdMock.mockResolvedValue(skill)
    getInstalledSkillDirectoryMock.mockReturnValue('/managed/skills/missing-directory')
    openPathMock.mockResolvedValue('The file does not exist')

    await expect(skillHandlers['skill.folder.open']({ skillId: 's1' }, ctx)).rejects.toThrow(
      'Failed to open skill folder: The file does not exist'
    )
  })

  it('import_system lets errors propagate to IpcApi', async () => {
    importSystemMock.mockRejectedValue(new Error('import failed'))

    await expect(skillHandlers['skill.import_system']({ directoryPath: '/skill' }, ctx)).rejects.toThrow(
      'import failed'
    )
  })
})
