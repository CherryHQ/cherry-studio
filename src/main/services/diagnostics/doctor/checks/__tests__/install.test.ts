import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  loadNativeCaptureBackend: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AppUpdaterService: { checkForUpdates: services.checkForUpdates } } as never)
})
vi.mock('@main/services/screenshot/nativeCaptureBackend', () => ({
  loadNativeCaptureBackend: services.loadNativeCaptureBackend
}))

const { installNativeModules, installUpdateAvailable, installVersionChannel } = await import('../install')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.mocked(app.getVersion).mockReturnValue('2.0.0')
  services.checkForUpdates.mockResolvedValue({ currentVersion: '2.0.0', updateInfo: null })
  services.loadNativeCaptureBackend.mockReturnValue({})
})

describe('install-version-channel', () => {
  it('passes when the test plan is disabled', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('does not report stable builds when a test channel is selected', async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.BETA
    })
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('passes when the running prerelease matches the selected channel', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.1.0-rc.3')
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.RC
    })
    await expect(installVersionChannel.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and links to About when the prerelease and selected channels differ', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.1.0-beta.2')
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.dist.test_plan.enabled': true,
      'app.dist.test_plan.channel': UpgradeChannel.RC
    })

    await expect(installVersionChannel.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'mismatch', params: { runningChannel: 'beta', selectedChannel: 'rc' } },
      actions: [{ kind: 'navigate', target: '/settings/about' }]
    })
  })
})

describe('install-update-available', () => {
  it('passes when the updater reports no newer release', async () => {
    await expect(installUpdateAvailable.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns with the available version and an in-Doctor install action', async () => {
    services.checkForUpdates.mockResolvedValue({
      currentVersion: '2.0.0',
      updateInfo: { version: '2.1.0' }
    })

    await expect(installUpdateAvailable.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'available', params: { currentVersion: '2.0.0', availableVersion: '2.1.0' } },
      actions: [{ kind: 'install_update' }]
    })
  })
})

describe('install-native-modules', () => {
  it('passes when the native capture backend loads', async () => {
    await expect(installNativeModules.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('reports a missing or unloadable native backend as an app bug', async () => {
    services.loadNativeCaptureBackend.mockImplementation(() => {
      throw new Error('dlopen failed')
    })

    await expect(installNativeModules.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      attribution: 'app-bug',
      detail: { variant: 'unavailable' },
      actions: [{ kind: 'report' }],
      evidence: [
        { key: 'module', value: 'node-screenshots', dataClass: 'public' },
        { key: 'error', value: 'dlopen failed', dataClass: 'consent_required' }
      ]
    })
  })
})
