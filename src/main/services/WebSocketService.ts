import { Server } from 'socket.io'

class WebSocketService {
  private io: Server | null = null
  private isStarted = false
  private port = 3000

  public start = async (): Promise<{ success: boolean; port?: number; error?: string }> => {
    if (this.isStarted && this.io) {
      return { success: true, port: this.port }
    }

    try {
      // 尝试启动服务器
      this.io = new Server(this.port, {
        cors: {
          origin: '*'
        }
      })

      // 设置连接处理
      this.io.on('connection', (socket) => {
        console.log('Client connected:', socket.id)

        // 监听移动端发送的消息
        socket.on('message', (data) => {
          console.log('Received message from mobile:', data)
          // 可以回复确认消息
          socket.emit('message_received', { success: true })
        })

        socket.on('disconnect', () => {
          console.log('Client disconnected:', socket.id)
        })
      })

      // 处理服务器错误
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
      console.log('WebSocket server stopped')

      return { success: true }
    } catch (error) {
      console.error('Failed to stop WebSocket server:', error)
      return { success: false }
    }
  }

  public getStatus = async (): Promise<{ isRunning: boolean; port?: number }> => {
    return {
      isRunning: this.isStarted,
      port: this.isStarted ? this.port : undefined
    }
  }
}

export default new WebSocketService()
