import { loggerService } from '@logger'
import { WebSocketCandidatesResponse, WebSocketStatusResponse } from '@shared/config/types'
import * as fs from 'fs'
import { networkInterfaces } from 'os'
import * as path from 'path'
import type { Socket } from 'socket.io'
import { Server } from 'socket.io'

import { windowService } from './WindowService'

const logger = loggerService.withContext('WebSocketService')

class WebSocketService {
  private io: Server | null = null
  private isStarted = false
  private port = 7017
  private connectedClients = new Set<string>()

  private getLocalIpAddress(): string | undefined {
    const interfaces = networkInterfaces()

    // 按优先级排序的网络接口名称模式
    const interfacePriority = [
      // macOS: 以太网/Wi-Fi 优先
      /^en[0-9]+$/, // en0, en1 (以太网/Wi-Fi)
      /^(en|eth)[0-9]+$/, // 以太网接口
      /^wlan[0-9]+$/, // 无线接口
      // Windows: 以太网/Wi-Fi 优先
      /^(Ethernet|Wi-Fi|Local Area Connection)/,
      /^(Wi-Fi|无线网络连接)/,
      // Linux: 以太网/Wi-Fi 优先
      /^(eth|enp|wlp|wlan)[0-9]+/,
      // 虚拟化接口（低优先级）
      /^bridge[0-9]+$/, // Docker bridge
      /^veth[0-9]+$/, // Docker veth
      /^docker[0-9]+/, // Docker interfaces
      /^br-[0-9a-f]+/, // Docker bridge
      /^vmnet[0-9]+$/, // VMware
      /^vboxnet[0-9]+$/, // VirtualBox
      // VPN 隧道接口（低优先级）
      /^utun[0-9]+$/, // macOS VPN
      /^tun[0-9]+$/, // Linux/Unix VPN
      /^tap[0-9]+$/, // TAP interfaces
      /^tailscale[0-9]*$/, // Tailscale VPN
      /^wg[0-9]+$/ // WireGuard VPN
    ]

    const candidates: Array<{ interface: string; address: string; priority: number }> = []

    for (const [name, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // 计算接口优先级
          let priority = 999 // 默认最低优先级
          for (let i = 0; i < interfacePriority.length; i++) {
            if (interfacePriority[i].test(name)) {
              priority = i
              break
            }
          }

          candidates.push({
            interface: name,
            address: iface.address,
            priority
          })
        }
      }
    }

    if (candidates.length === 0) {
      logger.warn('无法获取局域网 IP，使用默认 IP: 127.0.0.1')
      return '127.0.0.1'
    }

    // 按优先级排序，选择优先级最高的
    candidates.sort((a, b) => a.priority - b.priority)
    const best = candidates[0]

    logger.info(`获取局域网 IP: ${best.address} (interface: ${best.interface})`)
    return best.address
  }

  public start = async (): Promise<{ success: boolean; port?: number; error?: string }> => {
    if (this.isStarted && this.io) {
      return { success: true, port: this.port }
    }

    try {
      this.io = new Server(this.port, {
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000
      })

      this.io.on('connection', (socket: Socket) => {
        this.connectedClients.add(socket.id)

        const mainWindow = windowService.getMainWindow()
        if (!mainWindow) {
          logger.error('Main window is null, cannot send connection event')
        } else {
          mainWindow.webContents.send('websocket-client-connected', {
            connected: true,
            clientId: socket.id
          })
          logger.info(`Connection event sent to renderer, total clients: ${this.connectedClients.size}`)
        }

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

      // Engine 层面的事件监听
      this.io.engine.on('connection_error', (err) => {
        logger.error('Engine connection error:', err)
      })

      this.io.engine.on('connection', (rawSocket) => {
        const remoteAddr = rawSocket.request.connection.remoteAddress
        logger.info(`[Engine] Raw connection from: ${remoteAddr}`)
        logger.info(`[Engine] Transport: ${rawSocket.transport.name}`)

        rawSocket.on('packet', (packet: { type: string; data?: any }) => {
          logger.info(
            `[Engine] ← Packet from ${remoteAddr}: type="${packet.type}"`,
            packet.data ? { data: packet.data } : {}
          )
        })

        rawSocket.on('packetCreate', (packet: { type: string; data?: any }) => {
          logger.info(`[Engine] → Packet to ${remoteAddr}: type="${packet.type}"`)
        })

        rawSocket.on('close', (reason: string) => {
          logger.warn(`[Engine] Connection closed from ${remoteAddr}, reason: ${reason}`)
        })

        rawSocket.on('error', (error: Error) => {
          logger.error(`[Engine] Connection error from ${remoteAddr}:`, error)
        })
      })

      // Socket.IO 握手失败监听
      this.io.on('connection_error', (err) => {
        logger.error('[Socket.IO] Connection error during handshake:', err)
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

  public getStatus = async (): Promise<WebSocketStatusResponse> => {
    return {
      isRunning: this.isStarted,
      port: this.isStarted ? this.port : undefined,
      ip: this.isStarted ? this.getLocalIpAddress() : undefined,
      clientConnected: this.connectedClients.size > 0
    }
  }

  public getAllCandidates = async (): Promise<WebSocketCandidatesResponse[]> => {
    const interfaces = networkInterfaces()

    // 按优先级排序的网络接口名称模式
    const interfacePriority = [
      // macOS: 以太网/Wi-Fi 优先
      /^en[0-9]+$/, // en0, en1 (以太网/Wi-Fi)
      /^(en|eth)[0-9]+$/, // 以太网接口
      /^wlan[0-9]+$/, // 无线接口
      // Windows: 以太网/Wi-Fi 优先
      /^(Ethernet|Wi-Fi|Local Area Connection)/,
      /^(Wi-Fi|无线网络连接)/,
      // Linux: 以太网/Wi-Fi 优先
      /^(eth|enp|wlp|wlan)[0-9]+/,
      // 虚拟化接口（低优先级）
      /^bridge[0-9]+$/, // Docker bridge
      /^veth[0-9]+$/, // Docker veth
      /^docker[0-9]+/, // Docker interfaces
      /^br-[0-9a-f]+/, // Docker bridge
      /^vmnet[0-9]+$/, // VMware
      /^vboxnet[0-9]+$/, // VirtualBox
      // VPN 隧道接口（低优先级）
      /^utun[0-9]+$/, // macOS VPN
      /^tun[0-9]+$/, // Linux/Unix VPN
      /^tap[0-9]+$/, // TAP interfaces
      /^tailscale[0-9]*$/, // Tailscale VPN
      /^wg[0-9]+$/ // WireGuard VPN
    ]

    const candidates: Array<{ host: string; interface: string; priority: number }> = []

    for (const [name, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // 计算接口优先级
          let priority = 999 // 默认最低优先级
          for (let i = 0; i < interfacePriority.length; i++) {
            if (interfacePriority[i].test(name)) {
              priority = i
              break
            }
          }

          candidates.push({
            host: iface.address,
            interface: name,
            priority
          })

          logger.debug(`Found interface: ${name} -> ${iface.address} (priority: ${priority})`)
        }
      }
    }

    // 按优先级排序返回
    candidates.sort((a, b) => a.priority - b.priority)
    logger.info(
      `Found ${candidates.length} IP candidates: ${candidates.map((c) => `${c.host}(${c.interface})`).join(', ')}`
    )
    return candidates
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
      const startTime = Date.now()

      logger.info(`Starting file transfer: ${filename} (${this.formatFileSize(totalSize)})`)

      // 向客户端发送文件开始的信号，包含文件名和总大小
      this.io!.emit('zip-file-start', { filename, totalSize })

      stream.on('data', (chunk) => {
        bytesSent += chunk.length
        const progress = (bytesSent / totalSize) * 100

        // 向客户端发送文件块
        this.io!.emit('zip-file-chunk', chunk)

        // 向渲染进程发送进度更新
        mainWindow?.webContents.send('file-send-progress', { progress })

        // 每10%记录一次进度
        if (Math.floor(progress) % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000
          const speed = elapsed > 0 ? bytesSent / elapsed : 0
          logger.info(`Transfer progress: ${Math.floor(progress)}% (${this.formatFileSize(speed)}/s)`)
        }
      })

      stream.on('end', () => {
        const totalTime = (Date.now() - startTime) / 1000
        const avgSpeed = totalTime > 0 ? totalSize / totalTime : 0
        logger.info(
          `File transfer completed: ${filename} in ${totalTime.toFixed(1)}s (${this.formatFileSize(avgSpeed)}/s)`
        )

        // 确保发送100%的进度
        mainWindow?.webContents.send('file-send-progress', { progress: 100 })
        // 向客户端发送文件结束的信号
        this.io!.emit('zip-file-end')
        resolve({ success: true })
      })

      stream.on('error', (error) => {
        logger.error(`File transfer failed: ${filename}`, error)
        reject({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      })
    })
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}

export default new WebSocketService()
