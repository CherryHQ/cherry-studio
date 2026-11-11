import semver from 'semver'

import type { AppEdition } from '@shared/types/appEdition'

import targets from './legacyBridgeTargets.json'

export type LegacyLinuxPackageType = 'AppImage' | 'deb' | 'rpm'

export type LegacyBridgeTarget = (typeof targets)[number]

export function findLegacyBridgeTarget(
  edition: AppEdition,
  platform: string,
  arch: string,
  linuxPackageType: LegacyLinuxPackageType = 'AppImage',
  portable = false
) {
  return targets.find(
    (target) =>
      target.edition === edition &&
      target.platform === platform &&
      target.arch === arch &&
      (platform !== 'linux' || target.url.endsWith(`.${linuxPackageType}`)) &&
      (platform !== 'win32' || target.url.endsWith(portable ? '-portable.exe' : '-setup.exe'))
  )
}

export function isLegacyBridgeCompatible(history: string, platform: string): boolean {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform]
  if (!os) return false
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
      return false
    lastTimestamp = time
    if (semver.major(version) === 1) lastLegacyVersion = version
  }
  return lastLegacyVersion !== undefined && semver.gte(lastLegacyVersion, '1.9.12')
}
