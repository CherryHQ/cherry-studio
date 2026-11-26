import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { application } from '@application'
import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry/node'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { isPortable } from '@main/core/platform'
import { probeOverrideSnapshot, resolveRegistryPaths } from '@main/data/services/utils/registryDataPaths'
import { loadNativeCaptureBackend } from '@main/services/screenshot'
import { isOutsidePath, isPathInside } from '@main/utils/file'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'

import { defineDoctorCheck, type DoctorProbeOutcome } from '../types'

function versionChannel(version: string): UpgradeChannel {
  if (version.includes(`-${UpgradeChannel.BETA}.`)) return UpgradeChannel.BETA
  if (version.includes(`-${UpgradeChannel.RC}.`)) return UpgradeChannel.RC
  return UpgradeChannel.LATEST
}

/**
 * An x64 build on an arm64 machine (Apple Silicon via Rosetta, Windows on ARM via WOW) runs
 * translated: slower, and every prebuilt native module is the x64 one. `process.arch` cannot
 * see this — the translator exists precisely to report `x64` — so ask Electron, which reads
 * the OS translation flag. The property is darwin/win32 only; elsewhere there is no translator.
 */
export const installArchitectureMatch = defineDoctorCheck({
  id: 'install-architecture-match',
  async run() {
    if (!app.runningUnderARM64Translation) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'translated', params: { arch: process.arch } },
      actions: [{ kind: 'navigate', target: '/settings/about' }],
      devMessage: `Running the ${process.arch} build under ARM64 translation on ${process.platform}`,
      evidence: [
        { key: 'processArch', value: process.arch, dataClass: 'public' },
        { key: 'platform', value: process.platform, dataClass: 'public' },
        { key: 'translated', value: true, dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})

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

function unreadableRegistry(
  filePath: string,
  namespace: 'bundled' | 'override',
  cause: string
): DoctorProbeOutcome<'install-provider-registry-readable'> {
  const file = path.basename(filePath)
  const bundledRoot = application.getPath('feature.provider_registry.data')
  return {
    status: 'warn',
    attribution: 'user-fixable',
    detail: { variant: namespace === 'override' ? 'unreadable_override' : 'unreadable', params: { file } },
    actions: [{ kind: 'navigate', target: '/settings/about' }, { kind: 'report' }],
    devMessage: `Using the in-bundle provider registry for ${file} (namespace: ${namespace})`,
    evidence: [
      { key: 'file', value: file, dataClass: 'public' },
      { key: 'namespace', value: namespace, dataClass: 'public' },
      { key: 'path', value: filePath, dataClass: 'local_only' },
      { key: 'bundledRoot', value: bundledRoot, dataClass: 'local_only' },
      { key: 'usingBundledFallback', value: true, dataClass: 'public' },
      { key: 'resourcesUnderTempDir', value: isUnderTempDir(bundledRoot), dataClass: 'public' },
      { key: 'portable', value: isPortable, dataClass: 'public' },
      { key: 'cause', value: cause, dataClass: 'consent_required' }
    ]
  }
}

export const providerRegistryReadable = defineDoctorCheck({
  id: 'install-provider-registry-readable',
  async run() {
    for (const { file } of providerRegistryService.getRegistryFallbacks()) {
      providerRegistryService.getCatalogVersion(file)
    }
    const [fallback] = providerRegistryService.getRegistryFallbacks()
    if (fallback) return unreadableRegistry(fallback.path, fallback.namespace, fallback.cause)

    const rejection = probeOverrideSnapshot()
    if (rejection) {
      return unreadableRegistry(
        application.getPath('feature.provider_registry.override', rejection.file),
        'override',
        rejection.cause
      )
    }

    const paths = resolveRegistryPaths()
    const files = [
      [paths.providers, readProviderRegistry],
      [paths.models, readModelRegistry],
      [paths.providerModels, readProviderModelRegistry]
    ] as const

    for (const [filePath, read] of files) {
      try {
        read(filePath)
      } catch (error) {
        const overrideRoot = application.getPath('feature.provider_registry.override')
        const namespace = isPathInside(filePath, overrideRoot) ? 'override' : 'bundled'
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
        return unreadableRegistry(filePath, namespace, cause)
      }
    }
    return { status: 'pass' }
  },
  fixes: {}
})

function isUnderTempDir(bundledRoot: string): boolean {
  const root = path.resolve(bundledRoot)
  const temp = path.resolve(os.tmpdir())
  if (!isOutsidePath(path.relative(temp, root))) return true

  // Resolve aliases such as /var and /private/var when the paths differ.
  try {
    return !isOutsidePath(path.relative(realpathSync.native(temp), realpathSync.native(root)))
  } catch {
    return false
  }
}
