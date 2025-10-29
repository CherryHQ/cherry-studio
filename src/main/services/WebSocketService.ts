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
  private port = 11451
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

          logger.debug(`Found interface: ${name} -> ${iface.address} (priority: ${priority})`)
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
          origin: '*'
        }
      })

      this.io.on('connection', (socket: Socket) => {
        logger.info(`=== Client connected: ${socket.id} ===`)
        logger.info(`Socket transport: ${socket.conn.transport.name}`)
        this.connectedClients.add(socket.id)
        logger.info(`Total connected clients: ${this.connectedClients.size}`)

        const mainWindow = windowService.getMainWindow()

        if (!mainWindow) {
          logger.error('Main window is null, cannot send connection event')
        } else {
          logger.info('Main window found, sending websocket-client-connected event to renderer')
          mainWindow.webContents.send('websocket-client-connected', {
            connected: true,
            clientId: socket.id
          })
          logger.info('Event sent successfully')
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

      this.io.engine.on('connection_error', (err) => {
        logger.error('WebSocket connection error:', err)
      })

      // 添加更多引擎级别的事件监听
      this.io.engine.on('initial_headers', (_headers, request) => {
        logger.info('Received connection attempt:', {
          url: request.url,
          headers: request.headers
        })
      })

      this.io.engine.on('connection', (rawSocket) => {
        logger.info('Engine level connection established:', {
          remoteAddress: rawSocket.request.connection.remoteAddress
        })
      })

      this.isStarted = true
      logger.info(`WebSocket server started on port ${this.port}`)
      logger.info(`Server is listening on 0.0.0.0:${this.port}`)
      logger.info(`Allowed transports: ${JSON.stringify(this.io.engine.opts.transports)}`)

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

  public getAllCandidates = async (): Promise<
    Array<{
      host: string
      interface: string
      priority: number
    }>
  > => {
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
    logger.info(`Returning ${candidates.length} IP candidates for QR code`)
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
