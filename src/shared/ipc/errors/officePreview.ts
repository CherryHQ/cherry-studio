/** Office preview-domain IpcApi error codes. Import directly from this module on both sides. */
export const officePreviewErrorCodes = {
  FILE_TOO_LARGE: 'OFFICE_PREVIEW_FILE_TOO_LARGE',
  FILE_UNAVAILABLE: 'OFFICE_PREVIEW_FILE_UNAVAILABLE',
  INVALID_REQUEST: 'OFFICE_PREVIEW_INVALID_REQUEST',
  PARSE_FAILED: 'OFFICE_PREVIEW_PARSE_FAILED',
  UNSUPPORTED_EXTENSION: 'OFFICE_PREVIEW_UNSUPPORTED_EXTENSION'
} as const

export type OfficePreviewErrorCode = (typeof officePreviewErrorCodes)[keyof typeof officePreviewErrorCodes]

export function isOfficePreviewErrorCode(code: string): code is OfficePreviewErrorCode {
  return Object.values(officePreviewErrorCodes).includes(code as OfficePreviewErrorCode)
}
