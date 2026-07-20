import type { MigrationRendererExportFailureReport } from '@shared/data/migration/v2/diagnostics'

const UNKNOWN_RENDERER_EXPORT_REPORT = Object.freeze({
  sourceRole: 'unknown' as const,
  operationRole: 'unknown' as const
})

export class RendererExportError extends Error {
  override readonly name = 'RendererExportError'

  constructor(
    readonly report: MigrationRendererExportFailureReport,
    cause: unknown
  ) {
    super('Migration data export failed', { cause })
  }
}

export function rendererExportReport(error: unknown): MigrationRendererExportFailureReport {
  return error instanceof RendererExportError ? error.report : UNKNOWN_RENDERER_EXPORT_REPORT
}

export function rendererExportMessage(error: unknown): string {
  const cause = error instanceof RendererExportError ? error.cause : error
  return cause instanceof Error ? cause.message : 'Migration data export failed'
}
