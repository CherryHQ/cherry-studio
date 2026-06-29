import { loggerService } from '@logger'
import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type { OfficePreviewRenderInput, OfficePreviewRenderResult } from '@shared/ipc/schemas/officePreview'
import { realpath, stat } from 'fs/promises'
import path from 'path'

import { convertXlsxToUniverWorkbook } from './officePreviewWorkbook'

const logger = loggerService.withContext('OfficePreviewService')
const OFFICE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024

function isUnsupportedPath(filePath: string): boolean {
  return path.isAbsolute(filePath) || filePath.split(/[\\/]+/).some((segment) => segment === '..')
}

async function resolvePreviewFile(input: OfficePreviewRenderInput): Promise<string> {
  if (isUnsupportedPath(input.filePath)) {
    throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
  }

  const workspacePath = path.resolve(input.workspacePath)
  const targetPath = path.resolve(workspacePath, input.filePath)

  try {
    const [workspaceRealPath, targetRealPath] = await Promise.all([realpath(workspacePath), realpath(targetPath)])
    const relative = path.relative(workspaceRealPath, targetRealPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }
    return targetRealPath
  } catch (error) {
    if (error instanceof IpcError) throw error
    logger.warn('Office preview file unavailable', error instanceof Error ? error : new Error(String(error)))
    throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
  }
}

class OfficePreviewService {
  public async render(input: OfficePreviewRenderInput): Promise<OfficePreviewRenderResult> {
    if (path.extname(input.filePath).toLowerCase() !== '.xlsx') {
      throw new IpcError(officePreviewErrorCodes.UNSUPPORTED_EXTENSION)
    }

    const targetRealPath = await resolvePreviewFile(input)
    const fileStat = await stat(targetRealPath)
    if (!fileStat.isFile()) {
      throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
    }
    if (fileStat.size > OFFICE_PREVIEW_MAX_BYTES) {
      throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
    }

    try {
      return {
        kind: 'sheet',
        workbook: await convertXlsxToUniverWorkbook(targetRealPath)
      }
    } catch (error) {
      logger.error('Failed to parse Office preview workbook', error instanceof Error ? error : new Error(String(error)))
      throw new IpcError(officePreviewErrorCodes.PARSE_FAILED)
    }
  }
}

export const officePreviewService = new OfficePreviewService()
