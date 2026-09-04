import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installVersionChannel } = await import('../install')
const ctx = { signal: new AbortController().signal }

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.mocked(app.getVersion).mockReturnValue('2.0.0')
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
