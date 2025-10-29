import { loggerService } from '@logger'
import * as fs from 'fs'
import { networkInterfaces } from 'os'
import * as path from 'path'
import { Server, Socket } from 'socket.io'

import { windowService } from './WindowService'

const logger = loggerService.withContext('WebSocketService')

class WebSocketService {
  private io: Server | null = null
  private isStarted = false
  private port = 7017
  private connectedClients = new Set<string>()

  private getLocalIpAddress(): string | undefined {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          logger.info(`获取局域网 IP: ${iface.address}`)
          return iface.address
        }
      }
    }
    logger.warn('无法获取局域网 IP，使用默认 IP: 127.0.0.1')
    return '127.0.0.1'
  }

  public start = async (): Promise<{ success: boolean; port?: number; error?: string }> => {
    if (this.isStarted && this.io) {
      return { success: true, port: this.port }
    }

    try {
      this.io = new Server(this.port, {
        cors: {
          origin: '*'
        }
      })

      this.io.on('connection', (socket: Socket) => {
        logger.info(`Client connected: ${socket.id}`)
        this.connectedClients.add(socket.id)

        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('websocket-client-connected', {
          connected: true,
          clientId: socket.id
        })

        socket.on('message', (data) => {
          logger.info('Received message from mobile:', data)
          mainWindow?.webContents.send('websocket-message-received', data)
          socket.emit('message_received', { success: true })
        })

        socket.on('disconnect', () => {
          logger.info(`Client disconnected: ${socket.id}`)
          this.connectedClients.delete(socket.id)

          if (this.connectedClients.size === 0) {
            mainWindow?.webContents.send('websocket-client-connected', {
              connected: false,
              clientId: socket.id
            })
          }
        })
      })

      this.io.engine.on('connection_error', (err) => {
        logger.error('WebSocket connection error:', err)
      })

      this.isStarted = true
      logger.info(`WebSocket server started on port ${this.port}`)

      return { success: true, port: this.port }
    } catch (error) {
      logger.error('Failed to start WebSocket server:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  public stop = async (): Promise<{ success: boolean }> => {
    if (!this.isStarted || !this.io) {
      return { success: true }
    }

    try {
      await new Promise<void>((resolve) => {
        this.io!.close(() => {
          resolve()
        })
      })

      this.io = null
      this.isStarted = false
      this.connectedClients.clear()
      logger.info('WebSocket server stopped')

      return { success: true }
    } catch (error) {
      logger.error('Failed to stop WebSocket server:', error as Error)
      return { success: false }
    }
  }

  public getStatus = async (): Promise<{
    isRunning: boolean
    port?: number
    ip?: string
    clientConnected: boolean
  }> => {
    return {
      isRunning: this.isStarted,
      port: this.isStarted ? this.port : undefined,
      ip: this.isStarted ? this.getLocalIpAddress() : undefined,
      clientConnected: this.connectedClients.size > 0
    }
  }

  public sendFile = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!this.isStarted || !this.io) {
      const errorMsg = 'WebSocket server is not running.'
      logger.error(errorMsg)
      return { success: false, error: errorMsg }
    }

    if (this.connectedClients.size === 0) {
      const errorMsg = 'No client connected.'
      logger.error(errorMsg)
      return { success: false, error: errorMsg }
    }

    const mainWindow = windowService.getMainWindow()

    return new Promise((resolve, reject) => {
      const stats = fs.statSync(filePath)
      const totalSize = stats.size
      const filename = path.basename(filePath)
      const stream = fs.createReadStream(filePath)
      let bytesSent = 0

      logger.info(`Starting to send file ${filename} (${totalSize} bytes)`)
      // 向客户端发送文件开始的信号，包含文件名和总大小
      this.io!.emit('zip-file-start', { filename, totalSize })

      stream.on('data', (chunk) => {
        bytesSent += chunk.length
        const progress = (bytesSent / totalSize) * 100
        // 向客户端发送文件块
        this.io!.emit('zip-file-chunk', chunk)

        // 向渲染进程发送进度更新
        mainWindow?.webContents.send('file-send-progress', { progress })
      })

      stream.on('end', () => {
        logger.info(`File ${filename} sent successfully.`)
        // 确保发送100%的进度
        mainWindow?.webContents.send('file-send-progress', { progress: 100 })
        // 向客户端发送文件结束的信号
        this.io!.emit('zip-file-end')
        resolve({ success: true })
      })

      stream.on('error', (error) => {
        logger.error('Failed to read and send file:', error)
        reject({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      })
    })
  }
}

export default new WebSocketService()
