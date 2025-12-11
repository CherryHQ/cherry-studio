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
      'js code evaluated via Chrome DevTools Runtime.evaluate. Must be one line; use semicolons for multiple statements.'
    ),
  timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)')
})

const OpenSchema = z.object({
  url: z.string().url().describe('URL to open in the controlled Electron window'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)')
})

export class CdpBrowserController {
  private win?: BrowserWindow

  private async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady()
    }
  }

  private async getWindow(forceNew = false): Promise<BrowserWindow> {
    await this.ensureAppReady()

    if (this.win && !this.win.isDestroyed() && !forceNew) {
      return this.win
    }

    if (this.win && !this.win.isDestroyed() && forceNew) {
      this.win.destroy()
    }

    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true
      }
    })

    // Use a standard Chrome UA to avoid some anti-bot blocks
    this.win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    // Log navigation lifecycle to help diagnose slow loads
    this.win.webContents.on('did-start-loading', () => logger.info('did-start-loading'))
    this.win.webContents.on('dom-ready', () => logger.info('dom-ready'))
    this.win.webContents.on('did-finish-load', () => logger.info('did-finish-load'))
    this.win.webContents.on('did-fail-load', (_e, code, desc) =>
      logger.warn('Navigation failed', { code, desc })
    )

    this.win.on('closed', () => {
      this.win = undefined
    })

    return this.win
  }

  public async open(url: string, timeout = 10000) {
    const win = await this.getWindow(true)
    logger.info('Loading URL', { url })
    const { webContents } = win

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

  public async execute(code: string, timeout = 5000) {
    if (/\n/.test(code)) {
      throw new Error('Code must be a single line; use semicolons to separate statements.')
    }

    const win = await this.getWindow()
    const dbg = win.webContents.debugger

    if (!dbg.isAttached()) {
      try {
        logger.info('Attaching debugger for execute')
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

  public async reset() {
    if (this.win && !this.win.isDestroyed()) {
      try {
        if (this.win.webContents.debugger.isAttached()) {
          this.win.webContents.debugger.detach()
        }
        this.win.close()
      } catch (error) {
        logger.warn('Error while resetting window', { error })
      }
    }
    this.win = undefined
    logger.info('Browser CDP context reset')
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
                }
              },
              required: ['url']
            }
          },
          {
            name: 'execute',
            description:
              'Run a single-line JavaScript snippet in the current page via Runtime.evaluate. Use semicolons for multiple statements.',
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
              properties: {}
            }
          }
        ]
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (name === 'open') {
        const { url, timeout } = OpenSchema.parse(args)
        const res = await this.controller.open(url, timeout ?? 10000)
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
        const { code, timeout } = ExecuteSchema.parse(args)
        try {
          const value = await this.controller.execute(code, timeout)
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
        await this.controller.reset()
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
