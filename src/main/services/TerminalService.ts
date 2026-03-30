import path from 'node:path'

import { loggerService } from '@logger'
import type { IPty } from '@lydell/node-pty'
import { spawn } from '@lydell/node-pty'
import { sessionService } from '@main/services/agents'
import { getDataPath, makeSureDirExists } from '@main/utils'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

const logger = loggerService.withContext('TerminalService')

interface TerminalSession {
  pty: IPty
  sessionId: string
  cwd: string
}

class TerminalService {
  private terminals = new Map<string, TerminalSession>()
  private mainWindow: BrowserWindow | null = null

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.registerIpcHandlers()
    logger.info('TerminalService initialized')
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(
      IpcChannel.Terminal_Create,
      (_event, sessionId: unknown, cwd?: unknown, cols?: unknown, rows?: unknown) => {
        return this.create(sessionId, cwd, cols, rows)
      }
    )

    ipcMain.handle(IpcChannel.Terminal_Write, (_event, sessionId: unknown, data: unknown) => {
      this.write(sessionId, data)
    })

    ipcMain.handle(IpcChannel.Terminal_Resize, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
      this.resize(sessionId, cols, rows)
    })

    ipcMain.handle(IpcChannel.Terminal_Kill, (_event, sessionId: unknown) => {
      this.kill(sessionId)
    })

    ipcMain.handle(IpcChannel.Terminal_List, () => {
      return this.list()
    })
  }

  async create(
    sessionId: unknown,
    cwd?: unknown,
    cols: unknown = 80,
    rows: unknown = 24
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const safeSessionId = this.validateSessionId(sessionId)
      if (this.terminals.has(safeSessionId)) {
        return { success: true }
      }
      const safeCwd = this.validateOptionalString(cwd, 'terminal cwd')
      const safeCols = this.validateDimension(cols, 'terminal cols')
      const safeRows = this.validateDimension(rows, 'terminal rows')
      const resolvedCwd = await this.resolveCwd(safeSessionId, safeCwd)
      const shell = this.getDefaultShell()
      const pty = spawn(shell, [], {
        cwd: resolvedCwd,
        cols: safeCols,
        rows: safeRows,
        env: { ...process.env } as Record<string, string>
      })

      const terminal: TerminalSession = { pty, sessionId: safeSessionId, cwd: resolvedCwd }
      this.terminals.set(safeSessionId, terminal)

      pty.onData((data) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, { sessionId: safeSessionId, data })
        }
      })

      pty.onExit(({ exitCode }) => {
        logger.info(`Terminal exited for session ${safeSessionId}, code: ${exitCode}`)
        this.terminals.delete(safeSessionId)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, {
            sessionId: safeSessionId,
            data: `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
            exited: true,
            exitCode
          })
        }
      })

      logger.info(`Terminal created for session ${safeSessionId}, cwd: ${resolvedCwd}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to create terminal for session ${sessionId}: ${message}`)
      return { success: false, error: message }
    }
  }

  write(sessionId: unknown, data: unknown): void {
    let safeSessionId: string
    let safeData: string

    try {
      safeSessionId = this.validateSessionId(sessionId)
      safeData = this.validateString(data, 'terminal input')
    } catch (error) {
      logger.warn('Rejected invalid terminal write payload', {
        error: error instanceof Error ? error.message : String(error),
        sessionIdType: typeof sessionId,
        dataType: typeof data
      })
      return
    }

    const terminal = this.terminals.get(safeSessionId)
    if (terminal) {
      terminal.pty.write(safeData)
    }
  }

  resize(sessionId: unknown, cols: unknown, rows: unknown): void {
    let safeSessionId: string
    let safeCols: number
    let safeRows: number

    try {
      safeSessionId = this.validateSessionId(sessionId)
      safeCols = this.validateDimension(cols, 'terminal cols')
      safeRows = this.validateDimension(rows, 'terminal rows')
    } catch (error) {
      logger.warn('Rejected invalid terminal resize payload', {
        error: error instanceof Error ? error.message : String(error),
        sessionIdType: typeof sessionId,
        cols,
        rows
      })
      return
    }

    const terminal = this.terminals.get(safeSessionId)
    if (terminal) {
      try {
        terminal.pty.resize(safeCols, safeRows)
      } catch (error) {
        logger.warn('Failed to resize terminal PTY', {
          sessionId: safeSessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  kill(sessionId: unknown): void {
    let safeSessionId: string

    try {
      safeSessionId = this.validateSessionId(sessionId)
    } catch (error) {
      logger.warn('Rejected invalid terminal kill payload', {
        error: error instanceof Error ? error.message : String(error),
        sessionIdType: typeof sessionId
      })
      return
    }

    const terminal = this.terminals.get(safeSessionId)
    if (terminal) {
      terminal.pty.kill()
      this.terminals.delete(safeSessionId)
      logger.info(`Terminal killed for session ${safeSessionId}`)
    }
  }

  list(): string[] {
    return Array.from(this.terminals.keys())
  }

  killAll(): void {
    for (const terminal of this.terminals.values()) {
      try {
        terminal.pty.kill()
      } catch {
        // ignore errors during cleanup
      }
    }
    this.terminals.clear()
    logger.info('All terminals killed')
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  private getDefaultWorkspace(agentId: string): string {
    const shortId = agentId.substring(agentId.length - 9)
    return path.join(getDataPath(), 'Agents', shortId)
  }

  private validateString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Invalid ${field}`)
    }
    return value
  }

  private validateOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
      return undefined
    }
    return this.validateString(value, field)
  }

  private validateSessionId(sessionId: unknown): string {
    return this.validateString(sessionId, 'terminal session id')
  }

  private validateDimension(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${field}`)
    }
    return value
  }

  private async resolveCwd(sessionId: string, cwd?: string): Promise<string> {
    const session = await sessionService.getSessionById(sessionId)

    if (!session) {
      throw new Error(`Session not found for terminal: ${sessionId}`)
    }

    const accessiblePaths =
      session.accessible_paths && session.accessible_paths.length > 0
        ? session.accessible_paths.map((item) => path.resolve(item))
        : [path.resolve(this.getDefaultWorkspace(session.agent_id))]

    const requestedCwd = path.resolve(cwd ?? accessiblePaths[0])
    const isAllowedPath = accessiblePaths.some((allowedPath) => {
      const relative = path.relative(allowedPath, requestedCwd)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })

    if (!isAllowedPath) {
      throw new Error(`Terminal cwd must stay within session accessible paths: ${requestedCwd}`)
    }

    makeSureDirExists(requestedCwd)

    return requestedCwd
  }
}

export const terminalService = new TerminalService()
