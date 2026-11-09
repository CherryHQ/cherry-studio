import { dialog, shell } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as LegacyUpgradeModule from '@data/migration/legacyUpgrade'
import { findLegacyUpgradeProfile } from '@data/migration/legacyUpgrade'

import { runLegacyUpgradeGate } from '../legacyUpgradeGate'

vi.mock('@data/migration/legacyUpgrade', async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyUpgradeModule>()),
  findLegacyUpgradeProfile: vi.fn()
}))

describe('legacy upgrade gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue('/legacy/profile')
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })

  it('permits normal startup without a prompt', async () => {
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue(undefined)
    expect(await runLegacyUpgradeGate()).toBe('skipped')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(application.quit).not.toHaveBeenCalled()
  })

  it('opens the installer directly and prevents bootstrap', async () => {
    expect(await runLegacyUpgradeGate()).toBe('handled')
    const [options] = vi.mocked(dialog.showMessageBox).mock.calls[0]
    expect(options).toMatchObject({ cancelId: 1, defaultId: 0 })
    expect(options).toHaveProperty('detail', expect.stringContaining('/legacy/profile'))
    expect(shell.openExternal).toHaveBeenCalledWith(
      expect.stringContaining('/releases/download/v2.1.10/Cherry-Studio-2.1.10-')
    )
    expect(application.quit).toHaveBeenCalledOnce()
  })

  it('quits without downloading when the dialog is cancelled or dismissed', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(application.quit).toHaveBeenCalledOnce()
  })

  it('fails closed on inspection errors', async () => {
    vi.mocked(findLegacyUpgradeProfile).mockImplementation(() => {
      throw new Error('Data directory unavailable')
    })
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Data directory unavailable')
    )
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(application.quit).toHaveBeenCalledOnce()
  })

  it('reports download launch failure and still prevents bootstrap', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('Browser unavailable'))
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(dialog.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Browser unavailable'))
    expect(application.quit).toHaveBeenCalledOnce()
  })
})
