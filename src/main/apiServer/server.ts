import { createServer } from 'node:http'

import { loggerService } from '../services/LoggerService'
import { app } from './app'
import { config } from './config'

const logger = loggerService.withContext('ApiServer')

export class ApiServer {
  private server: ReturnType<typeof createServer> | null = null

  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Server already running')
      return
    }

    // Load config
    const { port, host } = await config.load()

    // Create server
    this.server = createServer(async (req, res) => {
      try {
        const request = await this.nodeToWebRequest(req)
        const response = await app.fetch(request)
        await this.webToNodeResponse(response, res)
      } catch (error) {
        logger.error('Request processing error:', error)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    })

    // Start server
    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        logger.info(`API Server started at http://${host}:${port}`)
        logger.info(`API Key: ${config.get().apiKey}`)
        resolve()
      })

      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('API Server stopped')
        this.server = null
        resolve()
      })
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await config.reload()
    await this.start()
  }

  isRunning(): boolean {
    return this.server !== null
  }

  private async nodeToWebRequest(req: any): Promise<Request> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    let body: BodyInit | null = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      if (chunks.length > 0) {
        body = Buffer.concat(chunks)
      }
    }

    return new Request(url, {
      method: req.method,
      headers: req.headers,
      body
    })
  }

  private async webToNodeResponse(response: Response, res: any): Promise<void> {
    res.statusCode = response.status

    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (response.body) {
      const reader = response.body.getReader()
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          res.end()
        } else {
          res.write(value)
          await pump()
        }
      }
      await pump()
    } else {
      res.end()
    }
  }
}

export const apiServer = new ApiServer()
