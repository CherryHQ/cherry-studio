import { describe, expect, it } from 'vitest'

import { isPlatformSpecificPreferenceKey, matchPlatformSpecificGlob } from '../platformSpecificKeyMatch'

describe('platformSpecificKeyMatch', () => {
  it('matches shortcut.* and *.path starter patterns', () => {
    expect(matchPlatformSpecificGlob('shortcut.*', 'shortcut.zoom_in')).toBe(true)
    expect(matchPlatformSpecificGlob('shortcut.*', 'theme.mode')).toBe(false)
    expect(matchPlatformSpecificGlob('*.path', 'feature.notes.path')).toBe(true)
    expect(matchPlatformSpecificGlob('*.path', 'feature.notes.enabled')).toBe(false)
  })

  it('matches character classes used by finalize legality checks', () => {
    expect(matchPlatformSpecificGlob('theme[12]', 'theme1')).toBe(true)
    expect(matchPlatformSpecificGlob('theme[12]', 'theme3')).toBe(false)
  })

  it('isPlatformSpecificPreferenceKey ORs patterns', () => {
    const patterns = ['shortcut.*', '*.path'] as const
    expect(isPlatformSpecificPreferenceKey('shortcut.show_app', patterns)).toBe(true)
    expect(isPlatformSpecificPreferenceKey('feature.notes.path', patterns)).toBe(true)
    expect(isPlatformSpecificPreferenceKey('language', patterns)).toBe(false)
  })
})
