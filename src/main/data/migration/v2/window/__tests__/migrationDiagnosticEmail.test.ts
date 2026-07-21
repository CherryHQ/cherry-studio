import { describe, expect, it } from 'vitest'

import type { MigrationDiagnosticsSnapshot } from '../../diagnostics'
import { createMigrationDiagnosticEmailUrl } from '../migrationDiagnosticEmail'
import { createMigrationDiagnosticNativeI18n } from '../migrationDiagnosticNativeI18n'

const startedAt = '2026-07-21T08:00:00.000Z'
const endedAt = '2026-07-21T08:01:00.000Z'

function rendererFailureSnapshot(): MigrationDiagnosticsSnapshot {
  return {
    formatVersion: 1,
    app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
    state: 'failed',
    current: {
      trigger: 'initial',
      startedAt,
      endedAt,
      lastLocation: { scope: 'renderer_export', phase: 'finalize' },
      status: 'failed',
      failure: {
        kind: 'renderer_export_failed',
        scope: 'renderer_export',
        phase: 'finalize',
        errorCode: 'source_parse_failed',
        evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
      }
    }
  }
}

function versionFailureSnapshot(): MigrationDiagnosticsSnapshot {
  return {
    formatVersion: 1,
    app: { version: '2.1.0', platform: 'win32', arch: 'x64' },
    state: 'failed',
    current: {
      trigger: 'initial',
      startedAt,
      endedAt,
      lastLocation: { scope: 'gate', phase: 'validate' },
      status: 'failed',
      failure: {
        kind: 'upgrade_path_blocked',
        scope: 'gate',
        phase: 'validate',
        errorCode: 'v1_too_old',
        evidence: {
          kind: 'version_gate',
          context: {
            reason: 'v1_too_old',
            currentVersion: '2.1.0',
            directorySelectionRole: 'default',
            previousVersion: '1.8.0',
            requiredVersion: '1.9.12',
            gatewayVersion: null,
            versionLog: { state: 'parsed', validRecordCountBucket: '1', invalidRecordCountBucket: '0' }
          }
        }
      }
    }
  }
}

function decodeMailto(url: string): { subject: string; body: string } {
  const parsed = new URL(url)
  return {
    subject: decodeURIComponent(parsed.search.slice(1).split('&body=')[0].replace('subject=', '')),
    body: decodeURIComponent(parsed.search.slice(1).split('&body=')[1])
  }
}

describe('migrationDiagnosticEmail', () => {
  it('maps a renderer failure to the fixed English template and percent-encoded mailto', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')

    const url = createMigrationDiagnosticEmailUrl(rendererFailureSnapshot(), i18n)

    expect(url).toContain('Cherry%20Studio')
    expect(url).toContain('%0A')
    expect(url).not.toContain('+')
    expect(url.length).toBeLessThan(8_000)
    const { subject, body } = decodeMailto(url)
    expect(subject).toBe('Cherry Studio migration diagnostics — source_parse_failed — 2.0.0 — darwin-arm64')
    expect(body).toContain('App version: 2.0.0')
    expect(body).toContain('Platform / architecture: darwin / arm64')
    expect(body).toContain('Scope / phase: renderer_export / finalize')
    expect(body).toContain('Failure kind / error code: renderer_export_failed / source_parse_failed')
    expect(body).toContain('Source / operation role: redux / parse')
    expect(body).toContain('Previous app version: unknown')
    expect(body).toContain('Did you use a custom data directory?')
    expect(body).toContain('Does retrying reproduce the same failure consistently?')
    expect(body).toContain('What did you do immediately before the failure?')
    expect(body).toContain('What was visible in the migration window?')
    expect(body).toContain('Save the diagnostic ZIP and attach it manually to this email.')
    expect(body).toContain('Cherry Studio does not automatically attach, upload, or send the ZIP or this email.')
  })

  it('maps safe version-gate evidence to the fixed Chinese template', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('zh-CN')

    const { subject, body } = decodeMailto(createMigrationDiagnosticEmailUrl(versionFailureSnapshot(), i18n))

    expect(subject).toBe('Cherry Studio 迁移诊断 — v1_too_old — 2.1.0 — win32-x64')
    expect(body).toContain('应用版本：2.1.0')
    expect(body).toContain('平台 / 架构：win32 / x64')
    expect(body).toContain('范围 / 阶段：gate / validate')
    expect(body).toContain('失败类型 / 错误码：upgrade_path_blocked / v1_too_old')
    expect(body).toContain('来源 / 操作角色：unknown / unknown')
    expect(body).toContain('升级前版本：1.8.0')
    expect(body).toContain('是否使用了自定义数据目录？')
    expect(body).toContain('重试后是否每次都稳定复现？')
    expect(body).toContain('失败前执行了什么操作？')
    expect(body).toContain('迁移窗口中看到了什么现象？')
    expect(body).toContain('请保存诊断 ZIP，并手动附加到此邮件。')
    expect(body).toContain('Cherry Studio 不会自动附加、上传或发送诊断 ZIP 或此邮件。')
  })

  it('uses unknown failure fields when the strict snapshot has no failure', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')
    const snapshot: MigrationDiagnosticsSnapshot = {
      formatVersion: 1,
      app: { version: '2.0.0', platform: 'linux', arch: 'x64' },
      state: 'active'
    }

    const { subject, body } = decodeMailto(createMigrationDiagnosticEmailUrl(snapshot, i18n))

    expect(subject).toContain('unknown')
    expect(body).toContain('Scope / phase: unknown / unknown')
    expect(body).toContain('Failure kind / error code: unknown / unknown')
    expect(body).toContain('Source / operation role: unknown / unknown')
    expect(body).toContain('Previous app version: unknown')
  })

  it('does not include extra snapshot properties, raw errors, paths, stacks, or user content', async () => {
    const i18n = await createMigrationDiagnosticNativeI18n('en-US')
    const snapshot = rendererFailureSnapshot() as MigrationDiagnosticsSnapshot & Record<string, unknown>
    snapshot.path = '/Users/private/canary'
    snapshot.rawError = 'Bearer privacy-canary'
    snapshot.message = 'private user content'
    snapshot.stack = 'at /Users/private/source.ts:1'

    const url = createMigrationDiagnosticEmailUrl(snapshot, i18n)
    const decoded = decodeURIComponent(url)

    expect(decoded).not.toContain('/Users/private')
    expect(decoded).not.toContain('privacy-canary')
    expect(decoded).not.toContain('private user content')
    expect(decoded).not.toContain('source.ts')
  })
})
