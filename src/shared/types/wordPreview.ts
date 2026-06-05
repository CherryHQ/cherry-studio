export const WORD_PREVIEW_MAX_SIZE_BYTES = 25 * 1024 * 1024

export type WordPreviewErrorCode =
  | 'invalid_word_preview_request'
  | 'unsupported_word_extension'
  | 'word_file_too_large'
  | 'word_read_failed'

export interface WordPreviewRequest {
  filePath: string
  workspacePath: string
}

export type WordPreviewResult =
  | {
      data: Uint8Array
      success: true
    }
  | {
      error: {
        code: WordPreviewErrorCode
        message: string
      }
      success: false
    }
