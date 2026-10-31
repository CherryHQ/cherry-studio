import { once } from 'node:events'
import { createServer } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod'

export async function startMcpImportServer() {
  const calls: string[] = []
  const chats: { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = []
  const marker = `MP134-${Date.now()}`
  const http = createServer((req, res) => {
    const handle = async () => {
      if (req.url === '/mcp') {
        const mcp = new McpServer({ name: 'mp134-fixture', version: '1.0.0' })
        mcp.registerTool('mp134_echo', { inputSchema: { message: z.string() } }, async ({ message }) => {
          calls.push(message)
          return { content: [{ type: 'text', text: message }] }
        })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        res.on('close', () => void mcp.close())
        await mcp.connect(transport)
        await transport.handleRequest(req, res)
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      chats.push(body)
      const tool = body.tools?.find((item: { function: { name: string } }) =>
        item.function.name.includes('__mp134Echo_')
      )
      const lastUser = body.messages.findLastIndex((item: { role: string }) => item.role === 'user')
      const result = body.messages.slice(lastUser + 1).find((item: { role: string }) => item.role === 'tool')
      const call = tool && !result
      const delta = call
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'call_mp134',
                type: 'function',
                function: { name: tool.function.name, arguments: JSON.stringify({ message: marker }) }
              }
            ]
          }
        : { content: result ? `MCP returned ${marker}` : 'MCP unavailable' }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null) => ({
        id: 'chatcmpl-mp134',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'mp134-chat',
        choices: [{ index: 0, delta, finish_reason: finish }]
      })
      res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }, null))}\n\n`)
      res.end(`data: ${JSON.stringify(chunk({}, call ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`)
    }
    void handle().catch(() => {
      res.writeHead(500)
      res.end()
    })
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('MCP fixture did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    marker,
    calls,
    chats,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()))
        http.closeAllConnections()
      })
  }
}
