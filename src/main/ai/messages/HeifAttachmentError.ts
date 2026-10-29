import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

const detailKeys: Record<string, string> = {
  [fileErrorCodes.HEIF_TOO_LARGE]: 'heif_detail_too_large',
  [fileErrorCodes.HEIF_UNAVAILABLE]: 'heif_detail_unavailable',
  [fileErrorCodes.HEIF_BUSY]: 'heif_detail_busy',
  [fileErrorCodes.HEIF_TIMEOUT]: 'heif_detail_timeout'
}

export class HeifAttachmentError extends Error {
  readonly i18nKey: string
  readonly detailI18nKey: string

  constructor(error?: unknown, nonVision = false) {
    super(nonVision ? 'HEIF OCR is not supported yet' : 'HEIF attachment conversion failed')
    this.name = 'HeifAttachmentError'
    this.i18nKey = nonVision ? 'heif_non_vision_unsupported' : 'heif_conversion_failed'
    this.detailI18nKey = nonVision
      ? 'heif_detail_non_vision'
      : (error instanceof IpcError && detailKeys[error.code]) || 'heif_detail_convert'
  }
}
