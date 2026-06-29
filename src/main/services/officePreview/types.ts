import type { OfficePreviewErrorCode } from '@shared/ipc/errors/officePreview'
import type { OfficePreviewExtension } from '@shared/ipc/schemas/officePreview'

export interface OfficePreviewWorkerRequest {
  targetRealPath: string
  extension: OfficePreviewExtension
}

export type OfficePreviewWorkerResponse =
  | {
      ok: true
      html: string
    }
  | {
      ok: false
      code: OfficePreviewErrorCode
      message?: string
    }

export interface UtilityParentPort {
  once(event: 'message', listener: (event: { data: OfficePreviewWorkerRequest }) => void): void
  postMessage(message: OfficePreviewWorkerResponse): void
}
