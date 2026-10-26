import { once } from 'node:events'
import { createServer } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { startMockChatServer } from '../../../helpers/http/mockChatServer'

export const efficiencyImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAABQCAIAAABeYuqzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABJUlEQVR4nO3VSREDQRADwQVmJoV/eBiGHp0RQlC6vveL3g7Ch/6bRpABMaDLLdSAGNA8hhrQHIQJ6qZ8QAxoHkMNaA7CBHVTPiAGNI+hBjQHYYK6KR8QA5rHUAOagzBB3ZQPiAHNY6gBzUGYoG7KB8SA5jHUgOYgTFA35QNiQPMYakBzECaom/IBMaB5DDWgOQgT1E35gBjQPIYa0ByECeqmfEAMaB5DDWgOwgR1Uz4gBjSPoQY0B2GCuikfEAOax1ADmoMwQd2UD4gBzWOoAc1BmKBuygfEgOYx1IDmIExQN+UDYkDzGGpAcxAmqJvyATGgeQw1oDkIE9RN+YAY0DyGGtAchAnqpnxADGgeQw1oDsIEdVM+IAY0j6EGNAdhgpqzmOgPXoJjdh+RMw0AAAAASUVORK5CYII=',
  'base64'
)

export async function startChatEfficiencyServer() {
  const chat = await startMockChatServer()
  let origin = ''
  let toolCalls = 0
  let linkVisits = 0
  const http = createServer((req, res) => {
    const handle = async () => {
      if (req.url === '/image.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(efficiencyImage)
        return
      }
      if (req.url === '/details') {
        linkVisits++
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<title>MP-18 image details</title><p>MP-18 image details</p>')
        return
      }
      if (req.url === '/mcp') {
        const mcp = new McpServer({ name: 'mp18-images', version: '1.0.0' })
        mcp.registerTool('mp18_image', { inputSchema: {} }, async () => {
          toolCalls++
          return {
            content: [
              { type: 'resource_link', name: 'MP-18 image', uri: `${origin}/image.png`, mimeType: 'image/png' },
              { type: 'resource_link', name: 'MP-18 image details', uri: `${origin}/details`, mimeType: 'text/html' }
            ]
          }
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
      const lastUser = body.messages.findLastIndex((message: { role: string }) => message.role === 'user')
      if (!JSON.stringify(body.messages[lastUser]).includes('MP18_IMAGE_URL')) {
        const response = await fetch(`${chat.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        res.writeHead(response.status, { 'Content-Type': 'text/event-stream' })
        for await (const chunk of response.body!) res.write(chunk)
        res.end()
        return
      }
      const tool = body.tools?.find((item: { function: { name: string } }) => /mp18.*image/i.test(item.function.name))
      const result = body.messages.slice(lastUser + 1).some((message: { role: string }) => message.role === 'tool')
      if (!tool && !result) throw new Error('Image MCP tool was not offered to the model')
      const delta = result
        ? { content: 'MP18_IMAGE_DONE' }
        : {
            tool_calls: [
              {
                index: 0,
                id: 'mp18-image-call',
                type: 'function',
                function: { name: tool.function.name, arguments: '{}' }
              }
            ]
          }
      const chunk = (delta: object, finish: string | null) => ({
        id: 'chatcmpl-mp18',
        object: 'chat.completion.chunk',
        created: 1,
        model: chat.modelId,
        choices: [{ index: 0, delta, finish_reason: finish }]
      })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }, null))}\n\n`)
      res.end(`data: ${JSON.stringify(chunk({}, result ? 'stop' : 'tool_calls'))}\n\ndata: [DONE]\n\n`)
    }
    void handle().catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('MP-18 server did not bind')
  origin = `http://127.0.0.1:${address.port}`
  return {
    ...chat,
    baseUrl: `${origin}/v1`,
    origin,
    get toolCalls() {
      return toolCalls
    },
    get linkVisits() {
      return linkVisits
    },
    async close() {
      await chat.close()
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()))
        http.closeAllConnections()
      })
    }
  }
}
