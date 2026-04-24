import { describe, expect, it } from 'vitest'

import { shouldExclude } from '../PreferenceFilter'

describe('PreferenceFilter', () => {
  describe('shouldExclude', () => {
    it('excludes keys matching sensitive patterns', () => {
      expect(shouldExclude('provider.api_key', null)).toBe(true)
      expect(shouldExclude('user.password', null)).toBe(true)
      expect(shouldExclude('oauth.token', null)).toBe(true)
      expect(shouldExclude('service.secret', null)).toBe(true)
      expect(shouldExclude('api.credential', null)).toBe(true)
      expect(shouldExclude('some.auth_config', null)).toBe(true)
    })

    it('excludes values matching sensitive patterns', () => {
      expect(shouldExclude('normal.key', 'contains-api-key-value')).toBe(true)
      expect(shouldExclude('normal.key', 'has-secret-in-it')).toBe(true)
    })

    it('excludes machine state keys', () => {
      expect(shouldExclude('app.zoom_factor', '1.5')).toBe(true)
      expect(shouldExclude('app.window_state', '{"x":0}')).toBe(true)
      expect(shouldExclude('app.sidebar_width', '300')).toBe(true)
      expect(shouldExclude('app.last_active_topic', 'uuid-123')).toBe(true)
    })

    it('excludes absolute paths', () => {
      expect(shouldExclude('data.path', '/Users/me/data')).toBe(true)
      expect(shouldExclude('data.path', 'C:\\Users\\me\\data')).toBe(true)
    })

    it('excludes platform-specific shortcuts', () => {
      expect(shouldExclude('shortcut.toggle', 'CommandOrControl+Shift+P')).toBe(true)
    })

    it('keeps normal preferences', () => {
      expect(shouldExclude('theme.mode', 'dark')).toBe(false)
      expect(shouldExclude('language', 'zh-CN')).toBe(false)
      expect(shouldExclude('model.temperature', '0.7')).toBe(false)
      expect(shouldExclude('editor.fontSize', '14')).toBe(false)
    })

    it('keeps null values for non-sensitive keys', () => {
      expect(shouldExclude('theme.mode', null)).toBe(false)
    })
  })
})
