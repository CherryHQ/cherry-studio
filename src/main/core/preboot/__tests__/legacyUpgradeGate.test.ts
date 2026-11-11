import { dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as LegacyUpgradeModule from '@data/migration/legacyUpgrade'
import { findLegacyUpgradeProfile } from '@data/migration/legacyUpgrade'
import { showLegacyUpgradeWindow } from '@data/migration/legacyUpgradeWindow'
import { bootConfigService } from '@main/data/bootConfig'

import { runLegacyUpgradeGate } from '../legacyUpgradeGate'

vi.mock('@data/migration/legacyUpgrade', async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyUpgradeModule>()),
  findLegacyUpgradeProfile: vi.fn()
}))

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

vi.mock('@data/migration/legacyUpgradeWindow', () => ({ showLegacyUpgradeWindow: vi.fn() }))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { get: vi.fn(), set: vi.fn(), persist: vi.fn() } }))

describe('legacy upgrade gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue({ kind: 'legacy', path: '/legacy/profile' })
    vi.mocked(showLegacyUpgradeWindow).mockResolvedValue(undefined)
    vi.mocked(bootConfigService.get).mockReturnValue(null)
    vi.mocked(bootConfigService.persist).mockImplementation(() => {})
  })

  it('permits normal startup without a prompt', async () => {
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue(undefined)
    expect(await runLegacyUpgradeGate()).toBe('skipped')
    expect(showLegacyUpgradeWindow).not.toHaveBeenCalled()
    expect(application.quit).not.toHaveBeenCalled()
  })

  it('offers fixed installers and prerequisites before quitting without bootstrap', async () => {
    expect(await runLegacyUpgradeGate()).toBe('handled')
    const [screen, downloads] = vi.mocked(showLegacyUpgradeWindow).mock.calls[0]
    expect(screen.detail).toContain('2.1.0')
    expect(screen.detail).not.toContain('/legacy/profile')
    expect(screen.prerequisite).toContain('1.9.12')
    expect(downloads.bridge).toContain('/releases/download/v2.1.0/Cherry-Studio-2.1.0-')
    expect(downloads.prerequisite).toContain('/releases/download/v1.9.12/Cherry-Studio-1.9.12-')
    expect(application.quit).toHaveBeenCalledOnce()
  })

  it('persists a recovered v2 location and restarts without showing migration UI', async () => {
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue({ kind: 'recover', path: '/custom/profile' })
    vi.mocked(bootConfigService.get).mockReturnValue({ '/other/exe': '/other/profile' })
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(bootConfigService.set).toHaveBeenCalledWith(
      'app.user_data_path',
      expect.objectContaining({ '/other/exe': '/other/profile' })
    )
    const mapping = vi.mocked(bootConfigService.set).mock.calls[0][1]
    expect(Object.values(mapping!)).toContain('/custom/profile')
    expect(bootConfigService.persist).toHaveBeenCalledOnce()
    expect(application.relaunch).toHaveBeenCalledOnce()
    expect(showLegacyUpgradeWindow).not.toHaveBeenCalled()
  })

  it('does not restart or bootstrap when recovering the path cannot be persisted', async () => {
    vi.mocked(findLegacyUpgradeProfile).mockReturnValue({ kind: 'recover', path: '/custom/profile' })
    vi.mocked(bootConfigService.persist).mockImplementation(() => {
      throw new Error('Read-only config')
    })
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(bootConfigService.set).toHaveBeenLastCalledWith('app.user_data_path', null)
    expect(application.relaunch).not.toHaveBeenCalled()
    expect(application.quit).toHaveBeenCalledOnce()
    expect(showLegacyUpgradeWindow).not.toHaveBeenCalled()
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
    expect(showLegacyUpgradeWindow).not.toHaveBeenCalled()
    expect(application.quit).toHaveBeenCalledOnce()
  })

  it('reports download launch failure and still prevents bootstrap', async () => {
    vi.mocked(showLegacyUpgradeWindow).mockRejectedValueOnce(new Error('Browser unavailable'))
    expect(await runLegacyUpgradeGate()).toBe('handled')
    expect(dialog.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Browser unavailable'))
    expect(application.quit).toHaveBeenCalledOnce()
  })
})
