import type { MigrationDiagnosticFailure, MigrationDiagnosticsSnapshot } from '../diagnostics'
import type { MigrationDiagnosticNativeI18n } from './migrationDiagnosticNativeI18n'

export const MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL = 'support@cherry-ai.com'

interface EmailDiagnosticFields {
  readonly appVersion: string
  readonly platform: string
  readonly arch: string
  readonly scope: string
  readonly phase: string
  readonly failureKind: string
  readonly errorCode: string
  readonly sourceRole: string
  readonly operationRole: string
  readonly previousVersion: string
}

function selectFailure(snapshot: MigrationDiagnosticsSnapshot): MigrationDiagnosticFailure | null {
  if (snapshot.current?.status === 'failed' || snapshot.current?.status === 'interrupted') {
    return snapshot.current.failure
  }
  if (snapshot.previous?.status === 'failed' || snapshot.previous?.status === 'interrupted') {
    return snapshot.previous.failure
  }
  return null
}

function fieldsFromSnapshot(snapshot: MigrationDiagnosticsSnapshot, unknown: string): EmailDiagnosticFields {
  const failure = selectFailure(snapshot)

  return {
    appVersion: snapshot.app.version,
    platform: snapshot.app.platform,
    arch: snapshot.app.arch,
    scope: failure?.scope ?? unknown,
    phase: failure?.phase ?? unknown,
    failureKind: failure?.kind ?? unknown,
    errorCode: failure?.errorCode ?? unknown,
    sourceRole: unknown,
    operationRole: unknown,
    previousVersion: unknown
  }
}

function createBody(fields: EmailDiagnosticFields, i18n: MigrationDiagnosticNativeI18n): string {
  return [
    i18n.t('support.emailSummaryTitle'),
    i18n.t('support.emailAppVersion', { appVersion: fields.appVersion }),
    i18n.t('support.emailPlatformArch', { platform: fields.platform, arch: fields.arch }),
    i18n.t('support.emailScopePhase', { scope: fields.scope, phase: fields.phase }),
    i18n.t('support.emailFailure', { failureKind: fields.failureKind, errorCode: fields.errorCode }),
    i18n.t('support.emailSourceOperation', {
      sourceRole: fields.sourceRole,
      operationRole: fields.operationRole
    }),
    '',
    i18n.t('support.emailQuestionsTitle'),
    i18n.t('support.emailQuestionPreviousVersion', { previousVersion: fields.previousVersion }),
    i18n.t('support.emailQuestionCustomDataDirectory'),
    i18n.t('support.emailQuestionRetry'),
    i18n.t('support.emailQuestionPreviousAction'),
    i18n.t('support.emailQuestionWindowObservation'),
    '',
    i18n.t('support.emailAttachmentInstruction'),
    i18n.t('support.emailPrivacyNotice')
  ].join('\n')
}

export function createMigrationDiagnosticEmailUrl(
  snapshot: MigrationDiagnosticsSnapshot,
  i18n: MigrationDiagnosticNativeI18n
): string {
  const fields = fieldsFromSnapshot(snapshot, i18n.t('support.unknown'))
  const subject = i18n.t('support.emailSubject', {
    errorCode: fields.errorCode,
    appVersion: fields.appVersion,
    platformArch: `${fields.platform}-${fields.arch}`
  })
  const body = createBody(fields, i18n)

  return `mailto:${MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
