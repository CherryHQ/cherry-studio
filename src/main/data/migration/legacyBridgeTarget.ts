import semver from 'semver'

import type { AppEdition } from '@shared/types/appEdition'

import targets from './legacyBridgeTargets.json'

export const LEGACY_PREREQUISITE_VERSION = '1.9.12'
export const LEGACY_UPGRADE_VERSION = '2.1.0'
export type LegacyBridgeVersion = typeof LEGACY_PREREQUISITE_VERSION | typeof LEGACY_UPGRADE_VERSION

export type LegacyLinuxPackageType = 'AppImage' | 'deb' | 'rpm'

export type LegacyBridgeTarget = (typeof targets)[number] & { version: LegacyBridgeVersion }

const prerequisiteTarget: LegacyBridgeTarget = {
  version: LEGACY_PREREQUISITE_VERSION,
  edition: 'global',
  platform: 'win32',
  arch: 'x64',
  url: 'https://gitcode.com/CherryHQ/cherry-studio/releases/download/v1.9.12/Cherry-Studio-1.9.12-x64-portable.exe',
  sha512: 'KxUIh8bapKKiCeXX0r97OMFe2o1SvZ1lUV7bw/Gc6YwaQecKKi9x1/L0EkyQuombtANNkUnmIRCy4ixNUDAiKA==',
  size: 138986608,
  releaseDate: '2026-07-05T09:35:42Z'
}

export function findLegacyBridgeTarget(
  edition: AppEdition,
  platform: string,
  arch: string,
  linuxPackageType: LegacyLinuxPackageType = 'AppImage',
  portable = false,
  version: LegacyBridgeVersion = LEGACY_UPGRADE_VERSION
): LegacyBridgeTarget | undefined {
  if (version === LEGACY_PREREQUISITE_VERSION) {
    return portable &&
      edition === prerequisiteTarget.edition &&
      platform === prerequisiteTarget.platform &&
      arch === prerequisiteTarget.arch
      ? prerequisiteTarget
      : undefined
  }
  const target = targets.find(
    (target) =>
      target.edition === edition &&
      target.platform === platform &&
      target.arch === arch &&
      (platform !== 'linux' || target.url.endsWith(`.${linuxPackageType}`)) &&
      (platform !== 'win32' || target.url.endsWith(portable ? '-portable.exe' : '-setup.exe'))
  )
  return target && { ...target, version }
}

export function getLegacyBridgeVersion(history: string, platform: string): LegacyBridgeVersion | undefined {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform]
  if (!os) return
  let lastTimestamp = -Infinity
  let lastLegacyVersion: string | undefined
  for (const line of history.trim().split('\n')) {
    const [version, recordedOs, environment, packaged, mode, timestamp, extra] = line.trim().split('|')
    const time = Date.parse(timestamp)
    if (
      extra !== undefined ||
      !semver.valid(version) ||
      semver.prerelease(version) ||
      recordedOs !== os ||
      environment !== 'prod' ||
      packaged !== 'packaged' ||
      (mode !== 'install' && !(platform === 'win32' && mode === 'portable')) ||
      !Number.isFinite(time) ||
      time < lastTimestamp
    )
      return
    lastTimestamp = time
    if (semver.major(version) === 1) lastLegacyVersion = version
  }
  if (lastLegacyVersion) {
    return semver.gte(lastLegacyVersion, LEGACY_PREREQUISITE_VERSION)
      ? LEGACY_UPGRADE_VERSION
      : LEGACY_PREREQUISITE_VERSION
  }
}
