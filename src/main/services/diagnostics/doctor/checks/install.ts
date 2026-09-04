import { application } from '@application'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { app } from 'electron'

import { defineDoctorCheck } from '../types'

function versionChannel(version: string): UpgradeChannel {
  if (version.includes(`-${UpgradeChannel.BETA}.`)) return UpgradeChannel.BETA
  if (version.includes(`-${UpgradeChannel.RC}.`)) return UpgradeChannel.RC
  return UpgradeChannel.LATEST
}

export const installVersionChannel = defineDoctorCheck({
  id: 'install-version-channel',
  async run() {
    const preferences = application.get('PreferenceService')
    if (!preferences.get('app.dist.test_plan.enabled')) return { status: 'pass' }

    const version = app.getVersion()
    const runningChannel = versionChannel(version)
    const selectedChannel = preferences.get('app.dist.test_plan.channel')
    if (runningChannel === UpgradeChannel.LATEST || runningChannel === selectedChannel) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'mismatch', params: { runningChannel, selectedChannel } },
      actions: [{ kind: 'navigate', target: '/settings/about' }],
      devMessage: `Running ${runningChannel} build while the update channel is ${selectedChannel}`,
      evidence: [
        { key: 'version', value: version, dataClass: 'public' },
        { key: 'runningChannel', value: runningChannel, dataClass: 'public' },
        { key: 'selectedChannel', value: selectedChannel, dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})
