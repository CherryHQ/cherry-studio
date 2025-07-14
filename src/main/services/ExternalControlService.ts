import { isWin } from '@main/constant'
import { getTempDir } from '@main/utils/file'
import { ExternalControlServerType } from '@types'
import Logger from 'electron-log'
import type { Server as NetServer } from 'net'
import * as path from 'path'

import { ConfigKeys, configManager } from './ConfigManager'
import { windowService } from './WindowService'

export class ExternalControlService {
  private static defaultSocketPath = path.join(getTempDir(), 'cherry-studio.sock')

  private static defaultHttpPort = 9090

  private httpServer: NetServer | null = null
  private unixDomainSocketServer: NetServer | null = null

  constructor() {
    this.watchConfigChanges()
  }

  async start(): Promise<void> {
    const serverType = configManager.getExternalControlServerType()

    switch (serverType) {
      case ExternalControlServerType.HTTP: {
        const httpPort = configManager.getExternalControlHttpPort() ?? ExternalControlService.defaultHttpPort
        await this.startHttpServer(httpPort)
        break
      }
      case ExternalControlServerType.UNIX_DOMAIN_SOCKET: {
        if (isWin) {
          Logger.warn(
            `[ExternalControl] Unix domain socket server is not supported on Windows. Please use HTTP server instead.`
          )
          return
        }
        await this.startUnixDomainSocketServer(ExternalControlService.defaultSocketPath)
        break
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.all([this.stopHttpServer(), this.stopUnixDomainSocketServer()])
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async startHttpServer(port: number): Promise<void> {
    Logger.info(`[ExternalControl] Starting HTTP server on port ${port}...`)

    const { createServer } = await import('http')
    this.httpServer = createServer((req, res) => {
      req.on('data', (data) => {
        this.onData(data)
        res.end()
      })
    })

    await new Promise<void>((resolve) => {
      this.httpServer
        ?.listen(port, '127.0.0.1', () => {
          Logger.info(`[ExternalControl] HTTP server started on port ${port}`)
          resolve()
        })
        .on('error', (err) => {
          Logger.error(`[ExternalControl] Failed to start HTTP server:`, err.message)
          resolve()
        })
    })
  }

  async stopHttpServer(): Promise<void> {
    if (!this.httpServer) return

    Logger.info(`[ExternalControl] Stopping HTTP server...`)

    await new Promise<void>((resolve) => {
      this.httpServer
        ?.close(() => {
          Logger.info(`[ExternalControl] HTTP server stopped`)
          this.httpServer = null
          resolve()
        })
        .on('error', (err) => {
          Logger.error(`[ExternalControl] Failed to stop HTTP server:`, err.message)
          resolve()
        })
    })
  }

  async startUnixDomainSocketServer(path: string): Promise<void> {
    Logger.info(`[ExternalControl] Starting unix domain socket server...`)

    await this.assertSocketNotInUse(path)

    const { createServer } = await import('net')
    this.unixDomainSocketServer = createServer((socket) => {
      socket.on('data', (data) => {
        this.onData(data)
      })
    })

    await new Promise<void>((resolve) => {
      this.unixDomainSocketServer
        ?.listen(path, () => {
          Logger.info(`[ExternalControl] Unix domain socket server started at ${path}`)
          resolve()
        })
        .on('error', (err) => {
          Logger.error(`[ExternalControl] Failed to start unix domain socket server:`, err.message)
          resolve()
        })
    })
  }

  async stopUnixDomainSocketServer(): Promise<void> {
    if (!this.unixDomainSocketServer) return

    Logger.info(`[ExternalControl] Stopping unix domain socket server...`)

    await new Promise<void>((resolve) => {
      this.unixDomainSocketServer
        ?.close(() => {
          Logger.info(`[ExternalControl] Unix domain socket server stopped`)
          this.unixDomainSocketServer = null
          resolve()
        })
        .on('error', (err) => {
          Logger.error(`[ExternalControl] Failed to stop unix domain socket server:`, err.message)
          resolve()
        })
    })
  }

  private watchConfigChanges() {
    configManager.subscribe(ConfigKeys.ExternalControlServerType, () => this.restart())
    configManager.subscribe(ConfigKeys.ExternalControlHttpPort, () => this.restart())
  }

  private async assertSocketNotInUse(socketPath: string): Promise<void> {
    const { stat, mkdir, rm } = await import('fs/promises')

    const dirPath = path.dirname(socketPath)

    let dirExists = false
    try {
      await stat(dirPath)
      dirExists = true
    } catch {
      dirExists = false
    }

    if (!dirExists) {
      Logger.debug(`[ExternalControl] Socket directory does not exist, creating: ${dirPath}`)
      await mkdir(dirPath, { recursive: true })
    }

    await rm(socketPath, { force: true })
  }

  private onData(data: Buffer): void {
    Logger.debug(`[ExternalControl] Received data:`, data.toString())

    let json
    try {
      json = JSON.parse(data.toString())
    } catch (error) {
      Logger.error(`[ExternalControl] Failed to parse data:`, (error as Error).message)
      return
    }

    const { cmd, ...args } = json || {}
    Logger.debug(`[ExternalControl] Command:`, cmd)
    Logger.debug(`[ExternalControl] Arguments:`, args)

    switch (cmd) {
      case 'showApplication': {
        windowService.showMainWindow()
        break
      }
      case 'hideApplication': {
        break
      }
      case 'toggleApplication': {
        windowService.toggleMainWindow()
        break
      }
      case 'showQuickAssistant': {
        windowService.showMiniWindow()
        break
      }
      case 'hideQuickAssistant': {
        windowService.hideMiniWindow()
        break
      }
      case 'toggleQuickAssistant': {
        windowService.toggleMiniWindow()
        break
      }
      case undefined:
      default: {
        Logger.warn(`[ExternalControl] Unknown command:`, cmd)
      }
    }
  }
}

export const externalControlService = new ExternalControlService()
