import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath } from '../settingsPath'

describe('settings navigation input', () => {
  it.each(['/settings', '/settings?tab=provider', '/settings/provider', '/settings/voice?source=doctor'])(
    'preserves the allowed route %s',
    (path) => {
      expect(normalizeSettingsPath(path)).toBe(path)
    }
  )

  it.each([undefined, null, false, 0, {}, [], '/setting', '/settings-unsafe', 'https://example.com/settings'])(
    'falls back for an invalid route: %j',
    (input) => {
      expect(normalizeSettingsPath(input)).toBe(DEFAULT_SETTINGS_PATH)
    }
  )
})
