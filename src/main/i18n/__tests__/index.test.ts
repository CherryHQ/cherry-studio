import { getAppLanguage, getI18n, SUPPORTED_LANGUAGES, t } from '@main/i18n'
import { defaultLanguage } from '@shared/utils/languages'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('main i18n', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  describe('getAppLanguage', () => {
    it('uses the app.language preference when set', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'ja-JP')
      expect(getAppLanguage()).toBe('ja-JP')
    })

    it('falls back to the system locale (app.getLocale) when no preference is set', () => {
      // The shared electron mock returns 'en-US' from app.getLocale().
      expect(getAppLanguage()).toBe('en-US')
    })

    it('falls back to the default language when the system locale is not in the catalog', () => {
      // No preference set and 'ko-KR' has no catalog → resolves to the default,
      // not the raw system locale.
      vi.mocked(app.getLocale).mockReturnValueOnce('ko-KR')
      const resolved = getAppLanguage()
      expect(resolved).not.toBe('ko-KR')
      expect(resolved).toBe(defaultLanguage)
    })
  })

  describe('t', () => {
    it('resolves a key in the current language', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
      expect(t('dialog.save_file')).toBe('保存文件')
    })

    it('selects the catalog from the preference language', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(t('dialog.save_file')).toBe('Save File')
    })

    it('interpolates {{var}} placeholders', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(t('agent.session.workspace_status.inaccessible', { path: '/tmp/x' })).toBe(
        'Workspace path is not accessible: /tmp/x'
      )
    })

    it('leaves placeholders without a matching param intact', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(t('agent.session.workspace_status.inaccessible', { other: 'x' })).toBe(
        'Workspace path is not accessible: {{path}}'
      )
    })

    it('returns the key itself when it is missing from the catalog', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      // Missing everywhere: resolves neither the current language nor the en-US fallback.
      expect(t('does.not.exist')).toBe('does.not.exist')
    })

    it('falls back to en-US when the current language value is an untranslated marker', () => {
      // ja-JP carries "[to be translated]:Restore complete…" for this key; the marker is
      // a real string, so a naive ?? would not fall back — t() must treat it as missing
      // and surface the en-US text instead.
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'ja-JP')
      expect(t('backup.restore.notification.completed')).toBe('Restore complete — the app will restart momentarily.')
    })

    it('returns the key when both the current language and en-US carry the marker', async () => {
      // Extreme case: en-US itself is somehow marked untranslated. t() must keep
      // falling through to the key rather than surface a raw marker.
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'ja-JP')
      const { default: enUs } = await import('@main/i18n/locales/en-us.json')
      const notif = enUs.backup.restore.notification
      const original = notif.completed
      notif.completed = '[to be translated]:Restore complete'
      try {
        expect(t('backup.restore.notification.completed')).toBe('backup.restore.notification.completed')
      } finally {
        notif.completed = original
      }
    })

    it('resolves against an explicit `language` override, ignoring app.language', () => {
      // The API gateway's docs render one translation per requested language,
      // independent of the app's own language — this is what makes that possible.
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(t('dialog.save_file', undefined, 'zh-CN')).toBe('保存文件')
      expect(t('dialog.save_file')).toBe('Save File')
    })
  })

  describe('getI18n', () => {
    it('returns the { translation } subtree for the current language', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(getI18n().translation.appMenu.about).toBe('About')
    })

    it('returns the { translation } subtree for an explicit language argument', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(getI18n('zh-CN').translation.appMenu.about).toBe('关于')
    })
  })

  describe('SUPPORTED_LANGUAGES', () => {
    it('lists every language main carries a catalog for', () => {
      expect(SUPPORTED_LANGUAGES).toEqual(
        expect.arrayContaining([
          'en-US',
          'zh-CN',
          'zh-TW',
          'ja-JP',
          'ru-RU',
          'de-DE',
          'el-GR',
          'es-ES',
          'fr-FR',
          'pt-PT',
          'ro-RO',
          'vi-VN'
        ])
      )
      expect(SUPPORTED_LANGUAGES).toHaveLength(12)
    })
  })
})
