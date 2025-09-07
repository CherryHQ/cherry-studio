// port https://github.com/zcaceres/fetch-mcp/blob/main/src/index.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { z } from 'zod'

export const RequestPayloadSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional()
})

export type RequestPayload = z.infer<typeof RequestPayloadSchema>

export class Fetcher {
  private static async _fetch({ url, headers }: RequestPayload): Promise<Response> {
    try {
      const response = await net.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...headers
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }
      return response
    } catch (e: unknown) {
      if (e instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${e.message}`)
      } else {
        throw new Error(`Failed to fetch ${url}: Unknown error`)
      }
    }
  }

  static async html(requestPayload: RequestPayload) {
    try {
      const response = await this._fetch(requestPayload)
      const html = await response.text()
      return { content: [{ type: 'text', text: html }], isError: false }
    } catch (error) {
      return {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true
      }
    }
  }

  static async json(requestPayload: RequestPayload) {
    try {
      const response = await this._fetch(requestPayload)
      const json = await response.json()
      return {
        content: [{ type: 'text', text: JSON.stringify(json) }],
        isError: false
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true
      }
    }
  }

  static async txt(requestPayload: RequestPayload) {
    try {
      const response = await this._fetch(requestPayload)
      const html = await response.text()

      const dom = new JSDOM(html)
      const document = dom.window.document

      const scripts = document.getElementsByTagName('script')
      const styles = document.getElementsByTagName('style')
      Array.from(scripts).forEach((script: any) => script.remove())
      Array.from(styles).forEach((style: any) => style.remove())

      const text = document.body.textContent || ''

      const normalizedText = text.replace(/\s+/g, ' ').trim()

      return {
        content: [{ type: 'text', text: normalizedText }],
        isError: false
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true
      }
    }
  }

  static async markdown(requestPayload: RequestPayload) {
    try {
      const response = await this._fetch(requestPayload)
      const html = await response.text()
      const turndownService = new TurndownService()
      const markdown = turndownService.turndown(html)
      return { content: [{ type: 'text', text: markdown }], isError: false }
    } catch (error) {
      return {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true
      }
    }
  }
}

const server = new Server(
  {
    name: 'zcaceres/fetch',
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
        name: 'fetch_html',
        description: 'Fetch a website and return the content as HTML',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL of the website to fetch'
            },
            headers: {
              type: 'object',
              description: 'Optional headers to include in the request'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'fetch_markdown',
        description: 'Fetch a website and return the content as Markdown',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL of the website to fetch'
            },
            headers: {
              type: 'object',
              description: 'Optional headers to include in the request'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'fetch_txt',
        description: 'Fetch a website, return the content as plain text (no HTML)',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL of the website to fetch'
            },
            headers: {
              type: 'object',
              description: 'Optional headers to include in the request'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'fetch_json',
        description: 'Fetch a JSON file from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL of the JSON to fetch'
            },
            headers: {
              type: 'object',
              description: 'Optional headers to include in the request'
            }
          },
          required: ['url']
        }
      }
    ]
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { arguments: args } = request.params

  const validatedArgs = RequestPayloadSchema.parse(args)

  if (request.params.name === 'fetch_html') {
    return await Fetcher.html(validatedArgs)
  }
  if (request.params.name === 'fetch_json') {
    return await Fetcher.json(validatedArgs)
  }
  if (request.params.name === 'fetch_txt') {
    return await Fetcher.txt(validatedArgs)
  }
  if (request.params.name === 'fetch_markdown') {
    return await Fetcher.markdown(validatedArgs)
  }
  throw new Error('Tool not found')
})

class FetchServer {
  public server: Server
  constructor() {
    this.server = server
  }
}
export default FetchServer
