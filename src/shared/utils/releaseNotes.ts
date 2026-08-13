import { rcompare as compareSemverDescending } from 'semver'

const RELEASE_NOTE_MARKERS = {
  english: '<!--LANG:en-->',
  chinese: '<!--LANG:zh-CN-->',
  end: '<!--LANG:END-->'
} as const

const STABLE_RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export type ReleaseNotesEntry = {
  releaseNotes: string
  version: string
}

function hasCompleteLanguageMarkers(releaseNotes: string): boolean {
  const englishMarker = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.english)
  const chineseMarker = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.chinese, englishMarker + 1)
  const endMarker = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.end, chineseMarker + 1)
  return englishMarker >= 0 && chineseMarker > englishMarker && endMarker > chineseMarker
}

export function parseReleaseHistory(source: string): ReleaseNotesEntry[] {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('release-history.json must contain valid JSON')
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('release-history.json must contain a non-empty array')
  }

  const versions = new Set<string>()
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`release-history.json entry ${index} must be an object`)
    }

    const keys = Object.keys(entry).sort()
    if (keys.length !== 2 || keys[0] !== 'releaseNotes' || keys[1] !== 'version') {
      throw new Error(`release-history.json entry ${index} must contain only version and releaseNotes`)
    }

    const { releaseNotes, version } = entry as Record<string, unknown>
    if (typeof version !== 'string' || !STABLE_RELEASE_VERSION_PATTERN.test(version)) {
      throw new Error(`release-history.json entry ${index} must have a stable semantic version`)
    }
    if (versions.has(version)) {
      throw new Error(`release-history.json contains duplicate version ${version}`)
    }
    if (typeof releaseNotes !== 'string' || !releaseNotes.trim() || !hasCompleteLanguageMarkers(releaseNotes)) {
      throw new Error(`release-history.json entry ${index} must have complete bilingual release notes`)
    }

    versions.add(version)
    return { releaseNotes, version }
  })
}

export function mergeReleaseNotes(
  current: ReleaseNotesEntry,
  history: readonly ReleaseNotesEntry[]
): ReleaseNotesEntry[] {
  return [current, ...history.filter(({ version }) => version !== current.version)]
}

export function mergeReleaseHistory(
  preferred: readonly ReleaseNotesEntry[],
  fallback: readonly ReleaseNotesEntry[]
): ReleaseNotesEntry[] {
  const preferredVersions = new Set(preferred.map(({ version }) => version))
  return [...preferred, ...fallback.filter(({ version }) => !preferredVersions.has(version))].sort((left, right) =>
    compareSemverDescending(left.version, right.version)
  )
}

export function validateCurrentReleaseHistory(current: ReleaseNotesEntry, history: readonly ReleaseNotesEntry[]): void {
  if (!STABLE_RELEASE_VERSION_PATTERN.test(current.version)) return

  const historicalEntry = history.find(({ version }) => version === current.version)
  if (!historicalEntry) {
    throw new Error(`release-history.json must contain current stable version ${current.version}`)
  }
  if (historicalEntry.releaseNotes !== current.releaseNotes) {
    throw new Error(`release-history.json notes for ${current.version} must match electron-builder.yml`)
  }
}

export function hasMultiLanguageReleaseNotes(releaseNotes: string): boolean {
  return releaseNotes.includes(RELEASE_NOTE_MARKERS.english)
}

export function localizeReleaseNotes(releaseNotes: string, language: string | null | undefined): string {
  if (!hasMultiLanguageReleaseNotes(releaseNotes)) return releaseNotes

  const englishStart = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.english) + RELEASE_NOTE_MARKERS.english.length
  const chineseMarker = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.chinese, englishStart)
  const chineseStart = chineseMarker + RELEASE_NOTE_MARKERS.chinese.length
  const endMarker = releaseNotes.indexOf(RELEASE_NOTE_MARKERS.end, chineseStart)
  const isChinese = language === 'zh-CN' || language === 'zh-TW'

  if (isChinese && chineseMarker >= englishStart && endMarker >= chineseStart) {
    return releaseNotes.slice(chineseStart, endMarker).trim()
  }

  if (chineseMarker >= englishStart) {
    return releaseNotes.slice(englishStart, chineseMarker).trim()
  }

  return releaseNotes
    .replaceAll(RELEASE_NOTE_MARKERS.english, '')
    .replaceAll(RELEASE_NOTE_MARKERS.chinese, '')
    .replaceAll(RELEASE_NOTE_MARKERS.end, '')
    .trim()
}
