import { application } from '@application'
import { loadNativeCaptureBackend } from '@main/services/screenshot'
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

export const installUpdateAvailable = defineDoctorCheck({
  id: 'install-update-available',
  async run() {
    const update = await application.get('AppUpdaterService').queryUpdateAvailability()
    if (update.status === 'current') return { status: 'pass' }
    if (update.status === 'unsupported')
      return {
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: 'unsupported' },
        actions: [{ kind: 'navigate', target: '/settings/about' }]
      }

    const runningVersion = update.currentVersion
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: {
        variant: 'available',
        params: { currentVersion: runningVersion, availableVersion: update.version }
      },
      actions: [{ kind: 'navigate', target: '/settings/about' }],
      devMessage: `Update ${update.version} is available for ${runningVersion}`,
      evidence: [
        { key: 'currentVersion', value: runningVersion, dataClass: 'public' },
        { key: 'availableVersion', value: update.version, dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})

export const installNativeModules = defineDoctorCheck({
  id: 'install-native-modules',
  async run() {
    try {
      loadNativeCaptureBackend()
      return { status: 'pass' }
    } catch (error) {
      return {
        status: 'fail',
        attribution: 'app-bug',
        detail: { variant: 'unavailable' },
        actions: [{ kind: 'report' }],
        devMessage: 'The screenshot native backend is unavailable; this check covers node-screenshots only',
        evidence: [
          { key: 'module', value: 'node-screenshots', dataClass: 'public' },
          {
            key: 'error',
            value: error instanceof Error ? error.message : String(error),
            dataClass: 'consent_required'
          },
          ...(error instanceof Error && error.cause
            ? [
                {
                  key: 'cause',
                  value: error.cause instanceof Error ? error.cause.message : String(error.cause),
                  dataClass: 'consent_required' as const
                }
              ]
            : [])
        ]
      }
    }
  },
  fixes: {}
})
