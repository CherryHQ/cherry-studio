import { createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { createClaudeCode } from 'ai-sdk-provider-claude-code'
import express, { Request, Response } from 'express'
import { Server } from 'http'

const logger = loggerService.withContext('ClaudeCodeService')

export class ClaudeCodeService {
  private app: express.Application
  private server: Server | null = null
  private port: number = 0
  private claudeCodeProvider: any = null

  constructor() {
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware() {
    this.app.use(express.json())
    this.app.use(express.text())
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // Initialize claude-code provider
    this.app.post('/init', async (req: Request, res: Response) => {
      try {
        const config = req.body
        logger.info('Initializing claude-code provider with config', config)

        this.claudeCodeProvider = createClaudeCode(config)

        res.json({
          success: true,
          message: 'Claude-code provider initialized successfully'
        })
      } catch (error) {
        logger.error('Failed to initialize claude-code provider', error as Error)
        res.status(500).json({
          success: false,
          error: (error as Error).message
        })
      }
    })

    // Stream text completion endpoint
    this.app.post('/completions', async (req: Request, res: Response): Promise<void> => {
      try {
        if (!this.claudeCodeProvider) {
          res.status(400).json({
            success: false,
            error: 'Claude-code provider not initialized. Call /init first.'
          })
          return
        }

        const { modelId, params, options } = req.body
        logger.info('Processing completions request', { modelId, hasParams: !!params })

        // 创建执行器
        const executor = createExecutor('claude-code', options || {}, [])
        const model = this.claudeCodeProvider.languageModel('opus')

        // 执行流式文本生成
        const result = await executor.streamText({
          ...params,
          model,
          abortSignal: new AbortController().signal
        })
        console.log('result', result)
        // 使用 AI SDK 提供的便捷函数处理流式响应
        result.pipeUIMessageStreamToResponse(res)

        logger.info('Completions request completed successfully')
      } catch (error) {
        logger.error('Error in completions endpoint', error as Error)
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: (error as Error).message
          })
        }
      }
    })
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // 尝试使用固定端口，如果失败则使用系统分配端口
      const preferredPort = 23456

      this.server = this.app.listen(preferredPort, 'localhost', () => {
        if (this.server?.address()) {
          this.port = (this.server.address() as any)?.port || 0
          logger.info(`Claude-code HTTP service started on port ${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to start server'))
        }
      })

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          logger.warn(`Port ${preferredPort} is in use, trying with dynamic port`)
          // 如果固定端口被占用，使用动态端口
          this.server = this.app.listen(0, 'localhost', () => {
            if (this.server?.address()) {
              this.port = (this.server.address() as any)?.port || 0
              logger.info(`Claude-code HTTP service started on dynamic port ${this.port}`)
              resolve(this.port)
            } else {
              reject(new Error('Failed to start server'))
            }
          })

          this.server.on('error', (dynamicError) => {
            logger.error('Server error on dynamic port', dynamicError)
            reject(dynamicError)
          })
        } else {
          logger.error('Server error', error)
          reject(error)
        }
      })
    })
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Claude-code HTTP service stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  public getPort(): number {
    return this.port
  }

  public isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}

// 单例实例
export const claudeCodeService = new ClaudeCodeService()
