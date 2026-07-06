import { getAppLanguage, getI18n, t } from '@main/i18n'
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
  })

  describe('getI18n', () => {
    it('returns the { translation } subtree for the current language', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      expect(getI18n().translation.appMenu.about).toBe('About')
    })
  })
})
