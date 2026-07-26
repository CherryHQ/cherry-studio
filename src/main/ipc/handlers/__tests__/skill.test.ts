import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  installMock,
  uninstallMock,
  installFromZipMock,
  installFromDirectoryMock,
  listLocalMock,
  discoverSystemMock,
  importSystemMock
} = vi.hoisted(() => ({
  installMock: vi.fn(),
  uninstallMock: vi.fn(),
  installFromZipMock: vi.fn(),
  installFromDirectoryMock: vi.fn(),
  listLocalMock: vi.fn(),
  discoverSystemMock: vi.fn(),
  importSystemMock: vi.fn()
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: {
    install: installMock,
    uninstall: uninstallMock,
    installFromZip: installFromZipMock,
    installFromDirectory: installFromDirectoryMock,
    listLocal: listLocalMock,
    discoverSystem: discoverSystemMock,
    importSystem: importSystemMock
  }
}))

import { skillHandlers } from '../skill'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
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
    await skillHandlers['skill.install_from_zip']({ zipFilePath: '/a.zip' }, ctx)
    await skillHandlers['skill.install_from_directory']({ directoryPath: '/dir' }, ctx)
    expect(installFromZipMock).toHaveBeenCalledWith({ zipFilePath: '/a.zip' })
    expect(installFromDirectoryMock).toHaveBeenCalledWith({ directoryPath: '/dir' })
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

  it('import_system lets errors propagate to IpcApi', async () => {
    importSystemMock.mockRejectedValue(new Error('import failed'))

    await expect(skillHandlers['skill.import_system']({ directoryPath: '/skill' }, ctx)).rejects.toThrow(
      'import failed'
    )
  })
})
