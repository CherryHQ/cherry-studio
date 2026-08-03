import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportToWordMock, getVaultsMock, getFilesMock } = vi.hoisted(() => ({
  exportToWordMock: vi.fn(),
  getVaultsMock: vi.fn(),
  getFilesMock: vi.fn()
}))

vi.mock('@main/services/ExportService', () => ({ ExportService: vi.fn(() => ({ exportToWord: exportToWordMock })) }))
vi.mock('@main/services/ObsidianVaultService', () => ({
  default: vi.fn(() => ({ getVaults: getVaultsMock, getFilesByVaultName: getFilesMock }))
}))

import { exportHandlers } from '../export'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportHandlers', () => {
  it('to_word delegates the markdown + filename to ExportService', async () => {
    await exportHandlers['export.word.from_markdown']({ markdown: '# hi', fileName: 'doc' }, ctx)
    expect(exportToWordMock).toHaveBeenCalledWith('# hi', 'doc')
  })

  it('get_obsidian_vaults returns the vault list', async () => {
    getVaultsMock.mockReturnValue([{ path: '/v', name: 'v' }])
    expect(await exportHandlers['export.obsidian.get_vaults'](undefined, ctx)).toEqual([{ path: '/v', name: 'v' }])
  })

  it('get_obsidian_files queries the requested vault', async () => {
    getFilesMock.mockResolvedValue([{ path: '/v/a.md', type: 'markdown', name: 'a.md' }])
    expect(await exportHandlers['export.obsidian.get_files']({ vaultName: 'v' }, ctx)).toEqual([
      { path: '/v/a.md', type: 'markdown', name: 'a.md' }
    ])
    expect(getFilesMock).toHaveBeenCalledWith('v')
  })
})
