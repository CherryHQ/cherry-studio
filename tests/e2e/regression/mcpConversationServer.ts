import { once } from 'node:events'
import { createServer } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod'

interface ChatRequest {
  messages: { role: string; content?: string }[]
  tools?: { function: { name: string } }[]
  model: string
}

// Only the model is scripted; the application's MCP client, approval and result handling run normally.
export async function startMcpConversationServer() {
  const calls: { url: string; text: string; isError: boolean }[] = []
  const requests: ChatRequest[] = []
  const errors: string[] = []
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (req.url === '/mcp') {
        const mcp = new McpServer({ name: 'MP-135-fetch', version: '1.0.0' })
        mcp.registerTool(
          'fetch',
          { description: 'Read a web page title', inputSchema: { url: z.string().url() } },
          async ({ url }) => {
            const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
            const html = await response.text()
            const text = response.ok
              ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html)
              : `HTTP ${response.status}: ${url}`
            calls.push({ url, text, isError: !response.ok })
            return { content: [{ type: 'text', text }], isError: !response.ok }
          }
        )
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        res.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      }
      const request = body as ChatRequest
      requests.push(request)
      const last = request.messages.at(-1)
      const tool = request.tools?.find(({ function: fn }) => /^mcp__.*__fetch(?:_|$)/.test(fn.name))
      const url = last?.content?.includes('/mp-135-missing')
        ? 'https://example.com/mp-135-missing'
        : 'https://example.com'
      const id = `mp135-${requests.length}`
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id, model: request.model, object: 'chat.completion.chunk', created: 1, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        )
      chunk({ role: 'assistant', content: '' })
      if (last?.role === 'tool') {
        chunk({ content: `fetch 返回：${last.content}` })
        chunk({}, 'stop')
      } else if (tool) {
        chunk({
          tool_calls: [
            {
              index: 0,
              id,
              type: 'function',
              function: { name: tool.function.name, arguments: JSON.stringify({ url }) }
            }
          ]
        })
        chunk({}, 'tool_calls')
      } else {
        chunk({ content: 'No fetch tool was offered.' })
        chunk({}, 'stop')
      }
      res.end('data: [DONE]\n\n')
    })().catch((error: Error) => {
      errors.push(error.message)
      if (!res.headersSent) res.writeHead(500)
      res.end(error.message)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    requests,
    errors,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
