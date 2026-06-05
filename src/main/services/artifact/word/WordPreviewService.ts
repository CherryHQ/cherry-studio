import { promises as fs } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file/path'
import { AbsolutePathSchema } from '@shared/data/types/file'
import {
  WORD_PREVIEW_MAX_SIZE_BYTES,
  type WordPreviewErrorCode,
  type WordPreviewRequest,
  type WordPreviewResult
} from '@shared/types/wordPreview'
import * as z from 'zod'

const SUPPORTED_WORD_PREVIEW_EXTENSIONS = new Set(['.docx'])

const RelativeFilePathSchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes('\0'), 'filePath must not contain null bytes')
  .refine((s) => !s.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(s), 'filePath must be workspace-relative')

const WordPreviewRequestSchema = z.strictObject({
  filePath: RelativeFilePathSchema,
  workspacePath: AbsolutePathSchema
})

const logger = loggerService.withContext('WordPreviewService')

const fail = (code: WordPreviewErrorCode, message: string): WordPreviewResult => ({
  error: { code, message },
  success: false
})

const normalizeRelativeFilePath = (filePath: string): string => filePath.replace(/[\\/]+/g, path.sep)

export async function readWordPreview(request: WordPreviewRequest): Promise<WordPreviewResult> {
  const parsed = WordPreviewRequestSchema.safeParse(request)
  if (!parsed.success) {
    return fail('invalid_word_preview_request', 'Invalid Word preview request.')
  }

  const { workspacePath, filePath } = parsed.data
  const workspaceRoot = path.resolve(workspacePath)
  const resolvedFilePath = path.resolve(workspaceRoot, normalizeRelativeFilePath(filePath))

  if (!isPathInside(resolvedFilePath, workspaceRoot)) {
    return fail('invalid_word_preview_request', 'Word preview file must stay inside the workspace.')
  }

  if (!SUPPORTED_WORD_PREVIEW_EXTENSIONS.has(path.extname(resolvedFilePath).toLowerCase())) {
    return fail('unsupported_word_extension', 'Only .docx files can be previewed.')
  }

  try {
    const [realWorkspaceRoot, realFilePath] = await Promise.all([
      fs.realpath(workspaceRoot),
      fs.realpath(resolvedFilePath)
    ])
    if (!isPathInside(realFilePath, realWorkspaceRoot)) {
      return fail('invalid_word_preview_request', 'Word preview file must stay inside the workspace.')
    }

    const stats = await fs.stat(realFilePath)
    if (!stats.isFile()) {
      return fail('invalid_word_preview_request', 'Word preview path is not a file.')
    }
    if (stats.size > WORD_PREVIEW_MAX_SIZE_BYTES) {
      return fail('word_file_too_large', 'Word preview supports files up to 25 MB.')
    }

    const data = await fs.readFile(realFilePath)
    return {
      data: new Uint8Array(data),
      success: true
    }
  } catch (err) {
    const normalized = err instanceof Error ? err : new Error(String(err))
    logger.error(`Failed to read Word preview: ${resolvedFilePath}`, normalized)
    return fail('word_read_failed', 'Failed to read Word document preview.')
  }
}
