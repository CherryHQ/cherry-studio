import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { describe, expect, it } from 'vitest'

import {
  CODE_CLI_CONFIGS_KEY,
  isPreferenceResetKey,
  PREFERENCE_RESET_KEYS,
  PRESERVED_AFTER_REVIEW,
  sanitizeCodeCliConfigs
} from '../preferenceResetPolicy'

describe('PREFERENCE_RESET_KEYS — list integrity', () => {
  it('has no duplicates', () => {
    expect(new Set(PREFERENCE_RESET_KEYS).size).toBe(PREFERENCE_RESET_KEYS.length)
  })

  it('names only keys that exist in the generated preference schema', () => {
    // Complements the compile-time `satisfies readonly PreferenceKeyType[]`: this
    // also catches a key that survives typecheck but has no default to fall back
    // to, which is what "reset to target default" depends on.
    for (const key of PREFERENCE_RESET_KEYS) {
      expect(DefaultPreferences.default, key).toHaveProperty(key)
    }
  })

  it('never resets a key that was reviewed and preserved', () => {
    for (const key of Object.keys(PRESERVED_AFTER_REVIEW)) {
      expect(isPreferenceResetKey(key), key).toBe(false)
    }
  })

  it('documents every preserved key against a real preference key', () => {
    for (const key of Object.keys(PRESERVED_AFTER_REVIEW)) {
      expect(DefaultPreferences.default, key).toHaveProperty(key)
    }
  })

  it('gives every preserved key a non-empty reason', () => {
    for (const [key, reason] of Object.entries(PRESERVED_AFTER_REVIEW)) {
      expect(reason.length, key).toBeGreaterThan(10)
    }
  })
})

describe('isPreferenceResetKey — classification', () => {
  it.each([
    'app.user.id',
    'app.launch_on_boot',
    'app.tray.on_launch',
    'app.use_system_title_bar',
    'app.proxy.mode',
    'app.proxy.url',
    'app.proxy.bypass_rules',
    'data.backup.local.dir',
    'data.export.markdown.path',
    'feature.notes.path',
    'data.integration.obsidian.default_vault',
    'feature.file_processing.default_image_to_text',
    'feature.file_processing.default_document_to_markdown',
    'feature.binary.tools',
    'feature.selection.enabled',
    'feature.selection.filter_list',
    'feature.selection.filter_mode',
    'feature.api_gateway.enabled',
    'feature.api_gateway.api_key',
    'data.backup.local.auto_sync',
    'data.backup.nutstore.auto_sync',
    'data.backup.s3.auto_sync',
    'data.backup.webdav.auto_sync'
  ])('resets the device-bound key %s', (key) => {
    expect(isPreferenceResetKey(key)).toBe(true)
  })

  it('resets every auto-sync destination, so none is forgotten', () => {
    const autoSyncKeys = Object.keys(DefaultPreferences.default).filter((key) => key.endsWith('.auto_sync'))
    expect(autoSyncKeys.length).toBeGreaterThan(0)
    for (const key of autoSyncKeys) {
      expect(isPreferenceResetKey(key), key).toBe(true)
    }
  })

  it.each([
    'app.language',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'app.zoom_factor',
    'chat.message.font_size',
    'chat.default_model_id',
    'feature.notes.font_size',
    'feature.notes.sort_type',
    'shortcut.topic.create',
    'shortcut.quick_assistant.toggle',
    'app.user.name',
    'app.user.avatar',
    'data.backup.webdav.host',
    'data.backup.webdav.pass',
    'data.backup.s3.access_key_id',
    'feature.api_gateway.port',
    'feature.api_gateway.host',
    'app.dist.auto_update.enabled'
  ])('preserves the ordinary user preference %s', (key) => {
    expect(isPreferenceResetKey(key)).toBe(false)
  })

  it('preserves remote credentials as inert profile data while resetting every automatic trigger', () => {
    // Whole-profile restore keeps configuration, including the credentials the
    // archive already discloses; reset automation is the no-I/O boundary.
    for (const key of [
      'data.backup.nutstore.token',
      'data.backup.s3.access_key_id',
      'data.backup.s3.secret_access_key',
      'data.backup.webdav.pass',
      'data.integration.joplin.token',
      'data.integration.notion.api_key',
      'data.integration.siyuan.token',
      'data.integration.yuque.token'
    ]) {
      expect(isPreferenceResetKey(key), key).toBe(false)
      expect(PRESERVED_AFTER_REVIEW, key).toHaveProperty(key)
    }
    expect(isPreferenceResetKey('data.backup.webdav.auto_sync')).toBe(true)
    expect(isPreferenceResetKey('data.backup.webdav.host')).toBe(false)
    expect(isPreferenceResetKey('data.backup.webdav.user')).toBe(false)
  })

  it('resets a small, auditable fraction of the schema', () => {
    // A guard against policy creep: the list is an exception list, not a filter.
    const total = Object.keys(DefaultPreferences.default).length
    expect(PREFERENCE_RESET_KEYS.length).toBeLessThan(total * 0.15)
  })

  it('does not reset the partially-bound code-CLI key (it gets surgery instead)', () => {
    expect(isPreferenceResetKey(CODE_CLI_CONFIGS_KEY)).toBe(false)
  })

  it('ignores an unknown key', () => {
    expect(isPreferenceResetKey('not.a.real.key')).toBe(false)
  })
})

describe('sanitizeCodeCliConfigs', () => {
  it('strips the device-local fields and preserves provider configuration', () => {
    const result = sanitizeCodeCliConfigs({
      claude: {
        providers: { p1: { apiKey: 'k', config: { model: 'x' } } },
        current: 'p1',
        sortIndex: 2,
        terminal: 'iterm2',
        directory: '/Users/alice/work'
      }
    })
    expect(result).toEqual({
      kind: 'rewrite',
      strippedTools: ['claude'],
      value: {
        claude: {
          providers: { p1: { apiKey: 'k', config: { model: 'x' } } },
          current: 'p1',
          sortIndex: 2
        }
      }
    })
  })

  it('reports only the tools that actually carried device-local fields', () => {
    const result = sanitizeCodeCliConfigs({
      claude: { providers: {}, current: null, directory: '/tmp/a' },
      codex: { providers: {}, current: null }
    })
    expect(result).toMatchObject({ kind: 'rewrite', strippedTools: ['claude'] })
  })

  it('strips either field independently', () => {
    expect(sanitizeCodeCliConfigs({ a: { terminal: 'wt' } })).toMatchObject({
      value: { a: {} },
      strippedTools: ['a']
    })
    expect(sanitizeCodeCliConfigs({ a: { directory: 'C:\\work' } })).toMatchObject({
      value: { a: {} },
      strippedTools: ['a']
    })
  })

  it('leaves a non-object tool entry untouched rather than guessing', () => {
    const result = sanitizeCodeCliConfigs({ broken: 'oops', ok: { directory: '/x' } })
    expect(result).toMatchObject({ kind: 'rewrite', value: { broken: 'oops', ok: {} }, strippedTools: ['ok'] })
  })

  it('handles an empty map', () => {
    expect(sanitizeCodeCliConfigs({})).toEqual({ kind: 'rewrite', value: {}, strippedTools: [] })
  })

  it.each([
    ['a string', 'nope'],
    ['an array', []],
    ['null', null],
    ['undefined', undefined],
    ['a number', 3]
  ])('drops the row when the stored value is %s', (_label, raw) => {
    expect(sanitizeCodeCliConfigs(raw)).toEqual({ kind: 'delete' })
  })

  it('does not mutate the input', () => {
    const raw = { claude: { directory: '/Users/alice/work', current: 'p1' } }
    sanitizeCodeCliConfigs(raw)
    expect(raw.claude.directory).toBe('/Users/alice/work')
  })
})
