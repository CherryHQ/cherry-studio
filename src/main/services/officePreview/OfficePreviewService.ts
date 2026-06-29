import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { normalizeWorkspacePath } from '@main/utils/agentWorkspacePath'
import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type {
  OfficePreviewCancelResult,
  OfficePreviewExtension,
  OfficePreviewRenderInput,
  OfficePreviewRenderResult
} from '@shared/ipc/schemas/officePreview'
import { utilityProcess } from 'electron'

import officePreviewWorkerPath from './officePreviewWorker?modulePath'
import type { OfficePreviewWorkerRequest, OfficePreviewWorkerResponse } from './types'

const logger = loggerService.withContext('OfficePreviewService')

const OFFICE_PREVIEW_EXTENSIONS = new Set<OfficePreviewExtension>(['docx', 'xlsx', 'pptx'])
const OFFICE_PREVIEW_MAX_SIZE_BYTES = 20 * 1024 * 1024
const OFFICE_PREVIEW_TIMEOUT_MS = 15_000

type OfficePreviewUtilityProcess = ReturnType<typeof utilityProcess.fork>

interface ActiveOfficePreviewTask {
  cancel(): void
}

const isAbsoluteInputPath = (filePath: string): boolean =>
  path.isAbsolute(filePath) || filePath.startsWith('/') || filePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(filePath)

const getOfficePreviewExtension = (filePath: string): OfficePreviewExtension | null => {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  return OFFICE_PREVIEW_EXTENSIONS.has(ext as OfficePreviewExtension) ? (ext as OfficePreviewExtension) : null
}

const isPathInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function isRegisteredAgentWorkspace(workspacePath: string): Promise<boolean> {
  let normalizedWorkspacePath: string
  try {
    normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
  } catch {
    return false
  }

  const workspaces = await agentWorkspaceService.list({ includeSystem: true })
  return workspaces.some((workspace) => {
    try {
      return normalizeWorkspacePath(workspace.path) === normalizedWorkspacePath
    } catch {
      return false
    }
  })
}

function isWorkerResponse(value: unknown): value is OfficePreviewWorkerResponse {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const response = value as Partial<OfficePreviewWorkerResponse>
  if (response.ok === true) return typeof response.html === 'string'
  return response.ok === false && typeof response.code === 'string'
}

function getTaskKey(ownerId: string, requestId: string): string {
  return `${ownerId}:${requestId}`
}

class OfficePreviewService {
  private readonly activeTasks = new Map<string, ActiveOfficePreviewTask>()

  public async render(input: OfficePreviewRenderInput, ownerId: string): Promise<OfficePreviewRenderResult> {
    const extension = getOfficePreviewExtension(input.filePath)

    if (!extension) {
      throw new IpcError(officePreviewErrorCodes.UNSUPPORTED_EXTENSION)
    }

    if (input.filePath.includes('\0') || isAbsoluteInputPath(input.filePath)) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }

    if (!(await isRegisteredAgentWorkspace(input.workspacePath))) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }

    let targetRealPath: string
    try {
      const workspaceRealPath = await realpath(input.workspacePath)
      const targetPath = path.resolve(workspaceRealPath, input.filePath)
      targetRealPath = await realpath(targetPath)

      if (!isPathInside(workspaceRealPath, targetRealPath)) {
        throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
      }

      const fileStat = await stat(targetRealPath)
      if (!fileStat.isFile()) {
        throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
      }
      if (fileStat.size > OFFICE_PREVIEW_MAX_SIZE_BYTES) {
        throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
      }
    } catch (error) {
      if (error instanceof IpcError) throw error
      logger.warn('Office preview file unavailable', error instanceof Error ? error : new Error(String(error)))
      throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
    }

    return { html: await this.renderInUtilityProcess(input.requestId, ownerId, { targetRealPath, extension }) }
  }

  public cancel(requestId: string, ownerId: string): OfficePreviewCancelResult {
    const task = this.activeTasks.get(getTaskKey(ownerId, requestId))
    if (!task) return { cancelled: false }

    task.cancel()
    return { cancelled: true }
  }

  private renderInUtilityProcess(
    requestId: string,
    ownerId: string,
    request: OfficePreviewWorkerRequest
  ): Promise<string> {
    const taskKey = getTaskKey(ownerId, requestId)
    if (this.activeTasks.has(taskKey)) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }

    let child: OfficePreviewUtilityProcess
    try {
      child = utilityProcess.fork(officePreviewWorkerPath, [], {
        serviceName: 'Cherry Studio Office Preview',
        stdio: 'ignore'
      })
    } catch (error) {
      logger.error('Failed to start Office preview utility process', error as Error)
      throw new IpcError(officePreviewErrorCodes.PARSE_FAILED)
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false
      let exited = false
      const timeout = setTimeout(() => {
        finish(() => reject(new IpcError(officePreviewErrorCodes.PARSE_TIMEOUT)))
      }, OFFICE_PREVIEW_TIMEOUT_MS)
      timeout.unref?.()

      const finish = (settle: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.activeTasks.delete(taskKey)
        if (!exited) {
          child.kill()
        }
        settle()
      }

      this.activeTasks.set(taskKey, {
        cancel: () => {
          finish(() => reject(new IpcError(officePreviewErrorCodes.CANCELLED)))
        }
      })

      child.on('message', (message) => {
        if (!isWorkerResponse(message)) {
          logger.error(
            'Office preview utility process returned an invalid response',
            new Error('Invalid worker response')
          )
          finish(() => reject(new IpcError(officePreviewErrorCodes.PARSE_FAILED)))
          return
        }

        if (message.ok) {
          finish(() => resolve(message.html))
          return
        }

        if (message.code === officePreviewErrorCodes.PARSE_FAILED) {
          logger.error('Failed to render Office preview', new Error(message.message ?? message.code))
        }
        finish(() => reject(new IpcError(message.code, message.message ?? message.code)))
      })

      child.on('error', (error) => {
        const normalizedError = error as unknown
        logger.error(
          'Office preview utility process failed',
          normalizedError instanceof Error ? normalizedError : new Error(String(normalizedError))
        )
        finish(() => reject(new IpcError(officePreviewErrorCodes.PARSE_FAILED)))
      })

      child.on('exit', (code) => {
        exited = true
        if (settled) return
        logger.error('Office preview utility process exited before returning a result', new Error(`Exit code: ${code}`))
        finish(() => reject(new IpcError(officePreviewErrorCodes.PARSE_FAILED)))
      })

      try {
        child.postMessage(request)
      } catch (error) {
        logger.error('Failed to send Office preview request to utility process', error as Error)
        finish(() => reject(new IpcError(officePreviewErrorCodes.PARSE_FAILED)))
      }
    })
  }
}

export const officePreviewService = new OfficePreviewService()
