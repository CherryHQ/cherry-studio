import { application } from '@application'
import { loggerService } from '@logger'
import { normalizeWorkspacePath } from '@main/utils/agentWorkspacePath'
import { DataApiErrorFactory } from '@shared/data/api'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentWorkspaceDirectoryService')

export class AgentWorkspaceDirectoryService {
  ensureWorkspaceDirectory(rawPath: string): string {
    const workspacePath = normalizeWorkspacePath(rawPath)
    if (fs.existsSync(workspacePath)) {
      const stats = fs.statSync(workspacePath)
      if (!stats.isDirectory()) {
        throw DataApiErrorFactory.validation({ path: ['Workspace path must be a directory'] })
      }
      return workspacePath
    }

    try {
      fs.mkdirSync(workspacePath, { recursive: true })
      return workspacePath
    } catch (error) {
      logger.error('Failed to create workspace directory', {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  prepareDefaultWorkspaceDirectory(): string {
    return this.ensureWorkspaceDirectory(path.join(application.getPath('feature.agents.workspaces'), uuidv4()))
  }

  cleanupPreparedWorkspaceDirectory(workspacePath: string): void {
    try {
      fs.rmdirSync(workspacePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      logger.warn('Failed to clean up prepared workspace directory', {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export const agentWorkspaceDirectoryService = new AgentWorkspaceDirectoryService()
