import type { UpdateInfo } from 'builder-util-runtime'
import { gt, lte, rcompare, valid } from 'semver'

import type { ReleaseNotesEntry } from '@shared/utils/releaseNotes'

export function collectUpgradeReleases(
  fromVersion: string,
  releaseInfo: Pick<UpdateInfo, 'version' | 'releaseNotes'>,
  history: readonly ReleaseNotesEntry[]
): ReleaseNotesEntry[] {
  const fallback =
    typeof releaseInfo.releaseNotes === 'string'
      ? [{ version: releaseInfo.version, releaseNotes: releaseInfo.releaseNotes }]
      : (releaseInfo.releaseNotes ?? []).map(({ version, note }) => ({ version, releaseNotes: note ?? '' }))
  const entries = new Map<string, ReleaseNotesEntry>()
  for (const entry of [...history, ...fallback]) {
    if (
      valid(entry.version) &&
      gt(entry.version, fromVersion) &&
      lte(entry.version, releaseInfo.version) &&
      entry.releaseNotes.trim() &&
      !entries.has(entry.version)
    ) {
      entries.set(entry.version, entry)
    }
  }
  return [...entries.values()].sort((left, right) => rcompare(left.version, right.version))
}
