/** Document-export error codes shared by the converter, IPC boundary and renderer. */
export const exportErrorCodes = {
  EMPTY_DOCUMENT: 'EMPTY_DOCUMENT',
  DOCUMENT_TOO_LARGE: 'DOCUMENT_TOO_LARGE',
  INVALID_TABLE: 'INVALID_TABLE',
  INVALID_IMAGE: 'INVALID_IMAGE',
  DOCUMENT_SAVE_FAILED: 'DOCUMENT_SAVE_FAILED',
  CONVERSION_FAILED: 'CONVERSION_FAILED'
} as const

export type ExportErrorCode = (typeof exportErrorCodes)[keyof typeof exportErrorCodes]
