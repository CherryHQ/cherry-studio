import { describe, expect, it } from 'vitest'

import type { MigrationDiagnosticContext } from '../../diagnostics'
import { createMigrationDiagnosticEmailUrl, MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL } from '../migrationDiagnosticEmail'
import { createMigrationDiagnosticNativeI18n } from '../migrationDiagnosticNativeI18n'

function decodeMailto(url: string): { recipient: string; subject: string; body: string } {
  const parsed = new URL(url)
  return {
    recipient: parsed.pathname,
    subject: parsed.searchParams.get('subject') ?? '',
    body: parsed.searchParams.get('body') ?? ''
  }
}

describe('migrationDiagnosticEmail', () => {
  it('uses the fixed address and a percent-encoded English template with only compact diagnostic fields', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')
    const context = {
      source: 'renderer',
      stage: 'error',
      errorSummary: 'Could not copy records.',
      failure: {
        code: 'migration_engine_failed',
        origin: 'main',
        operation: 'run_migration'
      },
      overallProgress: 42,
      migrators: [{ id: 'messages', status: 'failed' }],
      privatePath: '/Users/private/canary',
      credential: 'Bearer secret'
    } as MigrationDiagnosticContext & Record<string, unknown>

    const url = createMigrationDiagnosticEmailUrl(
      context,
      { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
      i18n
    )

    expect(url).toContain('subject=Cherry%20Studio')
    expect(url).toContain('%0A')
    expect(url).not.toContain('+')
    const { recipient, subject, body } = decodeMailto(url)
    expect(recipient).toBe(MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL)
    expect(recipient).toBe('support@cherry-ai.com')
    expect(subject).toBe('Cherry Studio migration diagnostics — migration_engine_failed — 2.0.0 — darwin-arm64')
    expect(body).toContain('App version: 2.0.0')
    expect(body).toContain('Platform / architecture: darwin / arm64')
    expect(body).toContain('Migration stage: error')
    expect(body).toContain('Failure code: migration_engine_failed')
    expect(body).toContain('Error summary: Could not copy records.')
    expect(body).toContain('Please add what happened immediately before the failure and whether retry reproduces it.')
    expect(body).toContain('Save the diagnostic ZIP and attach it manually to this email.')
    expect(body).toContain('Cherry Studio does not automatically attach, upload, or send the ZIP or this email.')
    expect(body).not.toContain('/Users/private/canary')
    expect(body).not.toContain('Bearer secret')
  })

  it('omits unavailable failure fields and uses the Chinese template', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('zh-Hans')

    const { subject, body } = decodeMailto(
      createMigrationDiagnosticEmailUrl(
        { source: 'native', stage: 'preboot' },
        { version: '2.1.0', platform: 'win32', arch: 'x64' },
        i18n
      )
    )

    expect(i18n.locale).toBe('zh-CN')
    expect(subject).toBe('Cherry Studio 迁移诊断 — preboot — 2.1.0 — win32-x64')
    expect(body).toContain('应用版本：2.1.0')
    expect(body).toContain('迁移阶段：preboot')
    expect(body).not.toContain('错误码：')
    expect(body).not.toContain('错误摘要：')
    expect(body).toContain('请补充失败前执行的操作，以及重试后是否仍会复现。')
    expect(body).toContain('请保存诊断 ZIP，并手动附加到此邮件。')
    expect(body).toContain('Cherry Studio 不会自动附加、上传或发送诊断 ZIP 或此邮件。')
  })

  it('falls back unsupported locales to English', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('fr-FR')

    expect(i18n.locale).toBe('en-US')
    expect(i18n.t('save.savedTitle')).toBe('Diagnostic bundle saved')
  })
})
