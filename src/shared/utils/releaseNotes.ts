const RELEASE_NOTE_MARKERS = {
  english: '<!--LANG:en-->',
  chinese: '<!--LANG:zh-CN-->',
  end: '<!--LANG:END-->'
} as const

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
