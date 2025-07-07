import * as fs from 'fs'
import { networkInterfaces } from 'os'
import * as path from 'path'
import { Server, Socket } from 'socket.io'

import { windowService } from './WindowService'

class WebSocketService {
  private io: Server | null = null
  private isStarted = false
  private port = 3000
  private connectedClients = new Set<string>()

  private getLocalIpAddress(): string | undefined {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.info('获取局域网 IP：', iface.address)
          return iface.address
        }
      }
    }
    console.warn('无法获取局域网 IP，使用默认 IP: 127.0.0.1')
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
        console.log('Client connected:', socket.id)
        this.connectedClients.add(socket.id)

        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('websocket-client-connected', {
          connected: true,
          clientId: socket.id
        })

        socket.on('message', (data) => {
          console.log('Received message from mobile:', data)
          mainWindow?.webContents.send('websocket-message-received', data)
          socket.emit('message_received', { success: true })
        })

        socket.on('disconnect', () => {
          console.log('Client disconnected:', socket.id)
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
        console.error('WebSocket connection error:', err)
      })

      this.isStarted = true
      console.log(`WebSocket server started on port ${this.port}`)

      return { success: true, port: this.port }
    } catch (error) {
      console.error('Failed to start WebSocket server:', error)
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
      console.log('WebSocket server stopped')

      return { success: true }
    } catch (error) {
      console.error('Failed to stop WebSocket server:', error)
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
      console.error(errorMsg)
      return { success: false, error: errorMsg }
    }

    if (this.connectedClients.size === 0) {
      const errorMsg = 'No client connected.'
      console.error(errorMsg)
      return { success: false, error: errorMsg }
    }

    try {
      const fileBuffer = await fs.promises.readFile(filePath)
      const filename = path.basename(filePath)

      console.log('fileBuffer', fileBuffer.length)

      // 向所有客户端广播文件
      this.io.emit('zip-file', { filename, data: fileBuffer })

      console.log(`File ${filename} sent to ${this.connectedClients.size} clients.`)
      return { success: true }
    } catch (error) {
      console.error('Failed to read and send file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

export default new WebSocketService()
