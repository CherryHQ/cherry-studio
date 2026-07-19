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
  })

  it('renders the native migration diagnostic copy in en-US', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('failure.title')).toBe('Migration diagnostics')
    expect(i18n.t('action.save')).toBe('Save diagnostic bundle')
  })

  it('falls back to en-US for an unknown locale', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('fr-FR')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('recovery.title')).toBe('Previous migration interrupted')
    expect(i18n.t('action.exit')).toBe('Exit')
  })
})
