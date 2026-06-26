import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVaults, getFilesByVaultName } = vi.hoisted(() => ({
  getVaults: vi.fn(),
  getFilesByVaultName: vi.fn()
}))
vi.mock('@main/services/ObsidianVaultService', () => ({
  obsidianVaultService: { getVaults, getFilesByVaultName }
}))

import { obsidianHandlers } from '../obsidian'

const ctx = { senderId: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('obsidianHandlers', () => {
  it('get_vaults delegates to the service and returns the vault list', async () => {
    const vaults = [{ path: '/Vault', name: 'Vault' }]
    getVaults.mockReturnValue(vaults)
    expect(await obsidianHandlers['obsidian.get_vaults'](undefined, ctx)).toEqual(vaults)
    expect(getVaults).toHaveBeenCalledTimes(1)
  })

  it('get_files forwards the vaultName and returns the file tree', async () => {
    const files = [{ path: 'note.md', type: 'markdown', name: 'note.md' }]
    getFilesByVaultName.mockReturnValue(files)
    expect(await obsidianHandlers['obsidian.get_files']({ vaultName: 'Vault' }, ctx)).toEqual(files)
    expect(getFilesByVaultName).toHaveBeenCalledWith('Vault')
  })
})
