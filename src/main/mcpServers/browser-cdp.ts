import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Server as MCServer } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { app, BrowserWindow } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('MCPBrowserCDP')

const ExecuteSchema = z.object({
  code: z
    .string()
    .describe(
      'JavaScript evaluated via Chrome DevTools Runtime.evaluate. Keep it short; prefer one-line with semicolons for multiple statements.'
    ),
  timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  sessionId: z.string().optional().describe('Session identifier to target a specific page (default: default)')
})

const OpenSchema = z.object({
  url: z.url().describe('URL to open in the controlled Electron window'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)'),
  show: z.boolean().optional().describe('Whether to show the browser window (default: false)'),
  sessionId: z.string().optional().describe('Session identifier; separate sessions keep separate pages (default: default)')
})

export class CdpBrowserController {
  private windows: Map<string, { win: BrowserWindow; lastActive: number }> = new Map()
  private readonly maxSessions: number
  private readonly idleTimeoutMs: number

  constructor(options?: { maxSessions?: number; idleTimeoutMs?: number }) {
    this.maxSessions = options?.maxSessions ?? 5
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000
  }

  private async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady()
    }
  }

  private touch(sessionId: string) {
    const entry = this.windows.get(sessionId)
    if (entry) entry.lastActive = Date.now()
  }

  private sweepIdle() {
    const now = Date.now()
    for (const [id, entry] of this.windows.entries()) {
      if (now - entry.lastActive > this.idleTimeoutMs) {
        try {
          if (!entry.win.isDestroyed()) {
            if (entry.win.webContents.debugger.isAttached()) {
              entry.win.webContents.debugger.detach()
            }
            entry.win.close()
          }
        } catch (error) {
          logger.warn('Error closing idle session', { error, sessionId: id })
        }
        this.windows.delete(id)
      }
    }
  }

  private evictIfNeeded(newSessionId: string) {
    if (this.windows.size < this.maxSessions) return
    let lruId: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [id, entry] of this.windows.entries()) {
      if (id === newSessionId) continue
      if (entry.lastActive < lruTime) {
        lruTime = entry.lastActive
        lruId = id
      }
    }
    if (lruId) {
      const entry = this.windows.get(lruId)
      if (entry && !entry.win.isDestroyed()) {
        try {
          if (entry.win.webContents.debugger.isAttached()) {
            entry.win.webContents.debugger.detach()
          }
          entry.win.close()
        } catch (error) {
          logger.warn('Error evicting session', { error, sessionId: lruId })
        }
      }
      this.windows.delete(lruId)
      logger.info('Evicted session to respect maxSessions', { evicted: lruId })
    }
  }

  private async getWindow(sessionId = 'default', forceNew = false, show = false): Promise<BrowserWindow> {
    await this.ensureAppReady()

    this.sweepIdle()

    const existing = this.windows.get(sessionId)
    if (existing && !existing.win.isDestroyed() && !forceNew) {
      this.touch(sessionId)
      return existing.win
    }

    if (existing && !existing.win.isDestroyed() && forceNew) {
      try {
        if (existing.win.webContents.debugger.isAttached()) {
          existing.win.webContents.debugger.detach()
        }
      } catch (error) {
        logger.warn('Error detaching debugger before recreate', { error, sessionId })
      }
      existing.win.destroy()
      this.windows.delete(sessionId)
    }

    this.evictIfNeeded(sessionId)

    const win = new BrowserWindow({
      show,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true
      }
    })

    // Use a standard Chrome UA to avoid some anti-bot blocks
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    // Log navigation lifecycle to help diagnose slow loads
    win.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { sessionId }))
    win.webContents.on('dom-ready', () => logger.info(`dom-ready`, { sessionId }))
    win.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { sessionId }))
    win.webContents.on('did-fail-load', (_e, code, desc) =>
      logger.warn('Navigation failed', { code, desc })
    )

    win.on('closed', () => {
      this.windows.delete(sessionId)
    })

    this.windows.set(sessionId, { win, lastActive: Date.now() })
    return win
  }

  public async open(url: string, timeout = 10000, show = false, sessionId = 'default') {
    const win = await this.getWindow(sessionId, true, show)
    logger.info('Loading URL', { url, sessionId })
    const { webContents } = win
    this.touch(sessionId)

    const loadPromise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        webContents.removeListener('did-finish-load', onFinish)
        webContents.removeListener('did-fail-load', onFail)
        webContents.removeListener('dom-ready', onDomReady)
      }
      const onFinish = () => {
        cleanup()
        resolve()
      }
      const onDomReady = () => {
        cleanup()
        resolve()
      }
      const onFail = (_event: Electron.Event, code: number, desc: string) => {
        cleanup()
        reject(new Error(`Navigation failed (${code}): ${desc}`))
      }
      webContents.once('did-finish-load', onFinish)
      webContents.once('dom-ready', onDomReady)
      webContents.once('did-fail-load', onFail)
    })

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Navigation timed out')), timeout)
    })

    await Promise.race([win.loadURL(url), loadPromise, timeoutPromise])

    const currentUrl = webContents.getURL()
    const title = await webContents.getTitle()
    return { currentUrl, title }
  }

  public async execute(code: string, timeout = 5000, sessionId = 'default') {
    const win = await this.getWindow(sessionId)
    this.touch(sessionId)
    const dbg = win.webContents.debugger

    if (!dbg.isAttached()) {
      try {
        logger.info('Attaching debugger for execute', { sessionId })
        dbg.attach('1.3')
        await dbg.sendCommand('Page.enable')
        await dbg.sendCommand('Runtime.enable')
        logger.info('Debugger attached and domains enabled')
      } catch (error) {
        logger.error('Failed to attach debugger', { error })
        throw error
      }
    }

    const evalPromise = dbg.sendCommand('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true
    })

    const result = await Promise.race([
      evalPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Execution timed out')), timeout))
    ])

    const evalResult = result as any

    if (evalResult?.exceptionDetails) {
      const message = evalResult.exceptionDetails.exception?.description || 'Unknown script error'
      logger.warn('Runtime.evaluate raised exception', { message })
      throw new Error(message)
    }

    const value = evalResult?.result?.value ?? evalResult?.result?.description ?? null
    return value
  }

  public async reset(sessionId?: string) {
    if (sessionId) {
      const entry = this.windows.get(sessionId)
      if (entry && !entry.win.isDestroyed()) {
        try {
          if (entry.win.webContents.debugger.isAttached()) {
            entry.win.webContents.debugger.detach()
          }
          entry.win.close()
        } catch (error) {
          logger.warn('Error while resetting window', { error, sessionId })
        }
      }
      this.windows.delete(sessionId)
      logger.info('Browser CDP context reset', { sessionId })
      return
    }

    for (const [id, entry] of this.windows.entries()) {
      if (entry && !entry.win.isDestroyed()) {
        try {
          if (entry.win.webContents.debugger.isAttached()) {
            entry.win.webContents.debugger.detach()
          }
          entry.win.close()
        } catch (error) {
          logger.warn('Error while resetting window', { error, sessionId: id })
        }
      }
      this.windows.delete(id)
    }
    logger.info('Browser CDP context reset (all sessions)')
  }
}

export class BrowserCdpServer {
  public server: Server
  private controller = new CdpBrowserController()

  constructor() {
    const server = new MCServer(
      {
        name: '@cherry/browser-cdp',
        version: '0.1.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
      {
        name: 'open',
        description: 'Open a URL in a hidden Electron window controlled via Chrome DevTools Protocol',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to load'
            },
            timeout: {
              type: 'number',
              description: 'Navigation timeout in milliseconds (default 10000)'
            },
            show: {
              type: 'boolean',
              description: 'Whether to show the browser window (default false)'
            },
            sessionId: {
              type: 'string',
              description: 'Session identifier; separate sessions keep separate pages (default: default)'
            }
          },
          required: ['url']
        }
      },
          {
        name: 'execute',
        description:
          'Run JavaScript in the current page via Runtime.evaluate. Prefer short, single-line snippets; use semicolons for multiple statements.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'One-line JS to evaluate in page context'
                },
                timeout: {
                  type: 'number',
                  description: 'Timeout in milliseconds (default 5000)'
                },
                sessionId: {
                  type: 'string',
                  description: 'Session identifier; targets a specific page (default: default)'
                }
              },
              required: ['code']
            }
          },
          {
            name: 'reset',
            description: 'Reset the controlled window and detach debugger',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session identifier to reset; omit to reset all sessions'
                }
              }
            }
          }
        ]
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (name === 'open') {
        const { url, timeout, show, sessionId } = OpenSchema.parse(args)
        const res = await this.controller.open(url, timeout ?? 10000, show ?? false, sessionId ?? 'default')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res)
            }
          ],
          isError: false
        }
      }

      if (name === 'execute') {
        const { code, timeout, sessionId } = ExecuteSchema.parse(args)
        try {
          const value = await this.controller.execute(code, timeout, sessionId ?? 'default')
          return {
            content: [
              {
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value)
              }
            ],
            isError: false
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: (error as Error).message
              }
            ],
            isError: true
          }
        }
      }

      if (name === 'reset') {
        const { sessionId } = args as { sessionId?: string }
        await this.controller.reset(sessionId)
        return {
          content: [
            {
              type: 'text',
              text: 'reset'
            }
          ],
          isError: false
        }
      }

      throw new Error('Tool not found')
    })

    app.on('before-quit', () => {
      void this.controller.reset()
    })

    this.server = server
  }
}

export default BrowserCdpServer
