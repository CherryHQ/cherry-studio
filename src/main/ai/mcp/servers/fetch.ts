// port https://github.com/zcaceres/fetch-mcp/blob/main/src/index.ts

import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { applyTableRules } from '@main/utils/htmlToMarkdown'
import { fetchRemoteText } from '@main/utils/remoteFetch'

const requestPayloadSchema = (urlDescription: string) =>
  z.object({
    url: z.url().describe(urlDescription),
    headers: z.record(z.string(), z.string()).optional().describe('Optional headers to include in the request')
  })

type RequestPayload = z.infer<ReturnType<typeof requestPayloadSchema>>

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function buildHeaders(headers: RequestPayload['headers']): Headers {
  const resolvedHeaders = new Headers(headers)

  if (!resolvedHeaders.has('User-Agent')) {
    resolvedHeaders.set('User-Agent', DEFAULT_USER_AGENT)
  }

  return resolvedHeaders
}

async function fetchText({ url, headers }: RequestPayload): Promise<string> {
  // The URL is model-supplied and this tool is auto-callable, so direct
  // main-process fetches must bind the connection to validated DNS results.
  return fetchRemoteText(url, { headers: buildHeaders(headers), maxRedirects: 5 })
}

async function htmlToText(html: string): Promise<string> {
  // Delayed loading: jsdom costs tens of MB of RSS, so it must load on first tool call, not at boot.
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html)
  const document = dom.window.document

  const scripts = document.getElementsByTagName('script')
  const styles = document.getElementsByTagName('style')
  Array.from(scripts).forEach((script: any) => script.remove())
  Array.from(styles).forEach((style: any) => style.remove())

  const text = document.body.textContent || ''

  return text.replace(/\s+/g, ' ').trim()
}

async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import('turndown')
  const turndownService = applyTableRules(new TurndownService())
  return turndownService.turndown(html)
}

class FetchServer {
  public createServer(): McpServer {
    const server = new McpServer({
      name: 'zcaceres/fetch',
      version: '0.1.0'
    })

    const register = (
      name: string,
      description: string,
      urlDescription: string,
      transform: (text: string) => string | Promise<string>
    ) =>
      server.registerTool(name, { description, inputSchema: requestPayloadSchema(urlDescription) }, async (args) => ({
        content: [{ type: 'text', text: await transform(await fetchText(args)) }]
      }))

    register(
      'fetch_html',
      'Fetch a website and return the content as HTML',
      'URL of the website to fetch',
      (html) => html
    )
    register(
      'fetch_markdown',
      'Fetch a website and return the content as Markdown',
      'URL of the website to fetch',
      htmlToMarkdown
    )
    register(
      'fetch_txt',
      'Fetch a website, return the content as plain text (no HTML)',
      'URL of the website to fetch',
      htmlToText
    )
    register('fetch_json', 'Fetch a JSON file from a URL', 'URL of the JSON to fetch', (text) =>
      JSON.stringify(JSON.parse(text))
    )

    return server
  }
}
export default FetchServer
