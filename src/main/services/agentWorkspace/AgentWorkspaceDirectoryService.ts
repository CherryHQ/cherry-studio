import { application } from '@application'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentWorkspaceDirectoryService')

export type PreparedSystemWorkspaceDirectory = {
  path: string
  label: string
}

function normalizeWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path is required'] })
  }
  if (!path.isAbsolute(trimmed)) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path must be absolute'] })
  }
  return path.normalize(trimmed)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatSystemWorkspaceDate(now: Date): { datePart: string; timePart: string; label: string } {
  const datePart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const timePart = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const label = `${datePart} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return { datePart, timePart, label }
}

function sanitizeSessionIdSegment(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (sanitized || uuidv4()).slice(0, 8)
}

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

  prepareSystemWorkspaceForSession(sessionId: string, now = new Date()): PreparedSystemWorkspaceDirectory {
    const { datePart, timePart, label } = formatSystemWorkspaceDate(now)
    const workspacePath = this.ensureWorkspaceDirectory(
      path.join(
        application.getPath('feature.agents.workspaces'),
        'system',
        datePart,
        `${timePart}-${sanitizeSessionIdSegment(sessionId)}`
      )
    )
    return {
      path: workspacePath,
      label
    }
  }

  assertSystemWorkspacePath(workspacePath: string): void {
    const systemRoot = path.resolve(application.getPath('feature.agents.workspaces'), 'system')
    const targetPath = path.resolve(workspacePath)
    const relative = path.relative(systemRoot, targetPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw DataApiErrorFactory.validation({ path: ['System workspace path is outside the system workspace root'] })
    }
  }

  deleteSystemWorkspaceDirectory(workspacePath: string): void {
    this.assertSystemWorkspacePath(workspacePath)
    fs.rmSync(workspacePath, { recursive: true, force: true })
  }

  deleteSystemWorkspaceDirectoryAfterCommit(workspacePath: string): void {
    try {
      this.deleteSystemWorkspaceDirectory(workspacePath)
    } catch (error) {
      logger.error('Failed to delete system workspace directory after database delete', {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  deletePreparedSystemWorkspaceDirectory(prepared: { path: string }): void {
    try {
      this.assertSystemWorkspacePath(prepared.path)
      fs.rmdirSync(prepared.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      logger.warn('Failed to clean prepared system workspace directory', {
        path: prepared.path,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export const agentWorkspaceDirectoryService = new AgentWorkspaceDirectoryService()
