import { describe, expect, it } from 'vitest'

import { createMigrationDiagnosticNativeI18n } from '../migrationDiagnosticNativeI18n'

describe('migrationDiagnosticNativeI18n', () => {
  it('renders the native migration diagnostic copy in zh-CN', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('zh-CN')

    expect(i18n.locale).toBe('zh-CN')
    expect(i18n.t('failure.title')).toBe('迁移诊断')
    expect(i18n.t('action.save')).toBe('保存诊断包')
    expect(i18n.t('failure.code', { code: 'MIGRATION-DIAGNOSTIC-BUNDLE-SAVE-FAILED' })).toContain(
      'MIGRATION-DIAGNOSTIC-BUNDLE-SAVE-FAILED'
    )
    expect(
      i18n.t('support.emailSubject', {
        errorCode: 'sqlite_io',
        appVersion: '2.0.0',
        platformArch: 'darwin-arm64'
      })
    ).toBe('Cherry Studio 迁移诊断 — sqlite_io — 2.0.0 — darwin-arm64')
    expect(i18n.t('support.emailSummaryTitle')).toBe('自动诊断摘要')
    expect(i18n.t('support.emailQuestionCustomDataDirectory')).toBe('是否使用了自定义数据目录？')
    expect(i18n.t('support.emailPrivacyNotice')).toContain('不会自动附加、上传或发送')
    expect(i18n.t('support.unknown')).toBe('unknown')
  })

  it('renders the native migration diagnostic copy in en-US', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('failure.title')).toBe('Migration diagnostics')
    expect(i18n.t('action.save')).toBe('Save diagnostic bundle')
    expect(
      i18n.t('support.emailSubject', {
        errorCode: 'sqlite_io',
        appVersion: '2.0.0',
        platformArch: 'darwin-arm64'
      })
    ).toBe('Cherry Studio migration diagnostics — sqlite_io — 2.0.0 — darwin-arm64')
    expect(i18n.t('support.emailSummaryTitle')).toBe('Automatic diagnostic summary')
    expect(i18n.t('support.emailQuestionCustomDataDirectory')).toBe('Did you use a custom data directory?')
    expect(i18n.t('support.emailPrivacyNotice')).toContain('does not automatically attach, upload, or send')
    expect(i18n.t('support.unknown')).toBe('unknown')
  })

  it('falls back to en-US for an unknown locale', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('fr-FR')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('recovery.title')).toBe('Previous migration interrupted')
    expect(i18n.t('action.exit')).toBe('Exit')
    expect(i18n.t('support.emailSummaryTitle')).toBe('Automatic diagnostic summary')
    expect(i18n.t('support.emailQuestionCustomDataDirectory')).toBe('Did you use a custom data directory?')
  })
})
