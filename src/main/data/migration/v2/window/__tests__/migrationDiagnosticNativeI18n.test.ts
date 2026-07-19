import { describe, expect, it } from 'vitest'

import { createMigrationDiagnosticNativeI18n } from '../migrationDiagnosticNativeI18n'

describe('migrationDiagnosticNativeI18n', () => {
  it('renders the native migration diagnostic copy in zh-CN', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('zh-CN')

    expect(i18n.locale).toBe('zh-CN')
    expect(i18n.t('failure.title')).toBe('迁移诊断')
    expect(i18n.t('action.save')).toBe('保存诊断包')
    expect(i18n.t('failure.code', { code: 'MIGRATION-DIAGNOSTIC-ARCHIVE-FAILED' })).toContain(
      'MIGRATION-DIAGNOSTIC-ARCHIVE-FAILED'
    )
    expect(i18n.t('support.emailSubject')).toBe('Cherry Studio 迁移诊断')
    expect(i18n.t('support.emailBody')).toBe('请描述迁移问题，并手动附上已保存的诊断 ZIP 文件。')
  })

  it('renders the native migration diagnostic copy in en-US', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('failure.title')).toBe('Migration diagnostics')
    expect(i18n.t('action.save')).toBe('Save diagnostic bundle')
    expect(i18n.t('support.emailSubject')).toBe('Cherry Studio migration diagnostics')
    expect(i18n.t('support.emailBody')).toBe(
      'Please describe the migration issue and manually attach the saved diagnostic ZIP.'
    )
  })

  it('falls back to en-US for an unknown locale', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('fr-FR')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('recovery.title')).toBe('Previous migration interrupted')
    expect(i18n.t('action.exit')).toBe('Exit')
    expect(i18n.t('support.emailSubject')).toBe('Cherry Studio migration diagnostics')
    expect(i18n.t('support.emailBody')).toBe(
      'Please describe the migration issue and manually attach the saved diagnostic ZIP.'
    )
  })
})
