import type { MigrationDiagnosticContext } from '../diagnostics'
import type { MigrationDiagnosticNativeI18n } from './migrationDiagnosticNativeI18n'

export const MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL = 'support@cherry-ai.com'

export interface MigrationDiagnosticEmailApplicationMetadata {
  readonly version: string
  readonly platform: string
  readonly arch: string
}

function createEmailBody(
  context: MigrationDiagnosticContext,
  appMetadata: MigrationDiagnosticEmailApplicationMetadata,
  i18n: MigrationDiagnosticNativeI18n
): string {
  return [
    i18n.t('email.summary'),
    i18n.t('email.appVersion', { version: appMetadata.version }),
    i18n.t('email.platformArch', { platform: appMetadata.platform, arch: appMetadata.arch }),
    i18n.t('email.stage', { stage: context.stage }),
    ...(context.failureCode === undefined ? [] : [i18n.t('email.failureCode', { code: context.failureCode })]),
    ...(context.errorSummary === undefined ? [] : [i18n.t('email.errorSummary', { summary: context.errorSummary })]),
    '',
    i18n.t('email.prompt'),
    '',
    i18n.t('email.attach'),
    i18n.t('email.privacy')
  ].join('\n')
}

export function createMigrationDiagnosticEmailUrl(
  context: MigrationDiagnosticContext,
  appMetadata: MigrationDiagnosticEmailApplicationMetadata,
  i18n: MigrationDiagnosticNativeI18n
): string {
  const failure = context.failureCode ?? context.stage
  const subject = i18n.t('email.subject', {
    failure,
    version: appMetadata.version,
    platformArch: `${appMetadata.platform}-${appMetadata.arch}`
  })
  const body = createEmailBody(context, appMetadata, i18n)

  return `mailto:${MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
