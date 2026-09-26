import type { ExportErrorCode } from '@shared/ipc/errors/export'

export class DocumentConversionError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    readonly preview: string
  ) {
    super(message)
    this.name = 'DocumentConversionError'
  }
}
