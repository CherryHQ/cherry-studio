import path from 'node:path'

import { loggerService } from '@logger'
import { sessionService } from '@main/services/agents'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'

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
      (_event, sessionId: string, cwd?: string, cols?: number, rows?: number) => {
        return this.create(sessionId, cwd, cols, rows)
      }
    )

    ipcMain.handle(IpcChannel.Terminal_Write, (_event, sessionId: string, data: string) => {
      this.write(sessionId, data)
    })

    ipcMain.handle(IpcChannel.Terminal_Resize, (_event, sessionId: string, cols: number, rows: number) => {
      this.resize(sessionId, cols, rows)
    })

    ipcMain.handle(IpcChannel.Terminal_Kill, (_event, sessionId: string) => {
      this.kill(sessionId)
    })

    ipcMain.handle(IpcChannel.Terminal_List, () => {
      return this.list()
    })
  }

  async create(
    sessionId: string,
    cwd?: string,
    cols: number = 80,
    rows: number = 24
  ): Promise<{ success: boolean; error?: string }> {
    if (this.terminals.has(sessionId)) {
      return { success: true }
    }

    try {
      const resolvedCwd = await this.resolveCwd(sessionId, cwd)
      const shell = this.getDefaultShell()
      const pty = spawn(shell, [], {
        cwd: resolvedCwd,
        cols,
        rows,
        env: { ...process.env } as Record<string, string>
      })

      const terminal: TerminalSession = { pty, sessionId, cwd: resolvedCwd }
      this.terminals.set(sessionId, terminal)

      pty.onData((data) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, { sessionId, data })
        }
      })

      pty.onExit(({ exitCode }) => {
        logger.info(`Terminal exited for session ${sessionId}, code: ${exitCode}`)
        this.terminals.delete(sessionId)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, {
            sessionId,
            data: `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
            exited: true,
            exitCode
          })
        }
      })

      logger.info(`Terminal created for session ${sessionId}, cwd: ${resolvedCwd}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to create terminal for session ${sessionId}: ${message}`)
      return { success: false, error: message }
    }
  }

  write(sessionId: string, data: string): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      terminal.pty.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      try {
        terminal.pty.resize(cols, rows)
      } catch {
        // resize can fail if pty is exiting
      }
    }
  }

  kill(sessionId: string): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      terminal.pty.kill()
      this.terminals.delete(sessionId)
      logger.info(`Terminal killed for session ${sessionId}`)
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

  private async resolveCwd(sessionId: string, cwd?: string): Promise<string> {
    const session = await sessionService.getSessionById(sessionId)

    if (!session) {
      throw new Error(`Session not found for terminal: ${sessionId}`)
    }

    const accessiblePaths = session.accessible_paths?.map((item) => path.resolve(item)) ?? []
    if (accessiblePaths.length === 0) {
      throw new Error(`No accessible paths configured for terminal session: ${sessionId}`)
    }

    const requestedCwd = path.resolve(cwd ?? accessiblePaths[0])
    const isAllowedPath = accessiblePaths.some((allowedPath) => {
      const relative = path.relative(allowedPath, requestedCwd)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })

    if (!isAllowedPath) {
      throw new Error(`Terminal cwd must stay within session accessible paths: ${requestedCwd}`)
    }

    return requestedCwd
  }
}

export const terminalService = new TerminalService()
