import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'

import { createMcpHandler } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { createMcpSkillsFixture } from '../mcpSkills'

const blockSchema = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional()
})
const requestSchema = z.looseObject({
  model: z.string(),
  stream: z.boolean().optional(),
  messages: z.array(z.object({ role: z.string(), content: z.union([z.string(), blockSchema.array()]) })),
  tools: z.array(z.looseObject({ name: z.string() })).optional()
})

function respond(res: ServerResponse, body: z.infer<typeof requestSchema>, content: Record<string, unknown>) {
  const tool = content.type === 'tool_use'
  const message = {
    id: `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [content],
    stop_reason: tool ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 }
  }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', { message: { ...message, content: [], stop_reason: null } })
  event('content_block_start', {
    index: 0,
    content_block: tool ? { ...content, input: {} } : { type: 'text', text: '' }
  })
  event('content_block_delta', {
    index: 0,
    delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) }
      : { type: 'text_delta', text: content.text }
  })
  event('content_block_stop', { index: 0 })
  event('message_delta', {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 10 }
  })
  event('message_stop', {})
  res.end()
}

/** Scripted Anthropic model and real modern MCP peer for desktop acceptance. */
export async function startMcpSkillsServer() {
  const fixture = createMcpSkillsFixture()
  const handler = createMcpHandler(() => fixture.createServer(), { legacy: 'reject' })
  const turns: Array<{ tools: string[]; action: string }> = []
  let serverId = ''
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString()
      if (req.url?.startsWith('/mcp')) {
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers))
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        const response = await handler.fetch(
          new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(raw ? { body: raw } : {}) })
        )
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
        return
      }
      if (req.url?.includes('count_tokens')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ input_tokens: 10 }))
        return
      }
      const body = requestSchema.parse(JSON.parse(raw))
      const text = JSON.stringify(body.messages)
      const tools = body.tools?.map((tool) => tool.name) ?? []
      const blocks = body.messages.flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
      const calls = blocks.filter(
        (block) =>
          block.type === 'tool_use' &&
          ['list_mcp_skills', 'load_mcp_skill', 'read_mcp_skill_file'].some((name) => block.name?.endsWith(name))
      )
      const last = blocks.at(-1)
      let content: Record<string, unknown>
      let action = 'text'
      if (!text.includes('MCP_SKILL_ACCEPTANCE')) {
        content = { type: 'text', text: 'Background request complete' }
      } else if (
        last?.type === 'tool_result' &&
        (last.is_error || JSON.stringify(last.content).includes('not approved'))
      ) {
        content = { type: 'text', text: 'MCP_SKILL_DECLINED' }
      } else if (text.includes('CHERRY-2640')) {
        if (
          text.includes('MCP_SKILL_EXECUTION_TEST') &&
          !blocks.some((block) => block.type === 'tool_use' && ['Bash', 'bash'].includes(block.name ?? ''))
        ) {
          action = 'execute'
          content = {
            type: 'tool_use',
            id: `tool_${crypto.randomUUID()}`,
            name: tools.includes('Bash') ? 'Bash' : 'bash',
            input: { command: 'printf MCP_SKILL_EXECUTED' }
          }
        } else content = { type: 'text', text: 'MCP_SKILL_RESULT: CHERRY-2640' }
      } else {
        action = ['list_mcp_skills', 'load_mcp_skill', 'read_mcp_skill_file'][calls.length] ?? 'read_mcp_skill_file'
        const name = tools.find((tool) => tool.endsWith(action))
        if (name) {
          content = {
            type: 'tool_use',
            id: `tool_${crypto.randomUUID()}`,
            name,
            input: {
              ...(action === 'list_mcp_skills' ? {} : { server_id: serverId, skill_uri: fixture.uri }),
              ...(action === 'read_mcp_skill_file' ? { resource_uri: 'skill://reports/references/facts.txt' } : {})
            }
          }
        } else {
          const search = tools.find((tool) => /tool.?search/i.test(tool))
          content = search
            ? {
                type: 'tool_use',
                id: `tool_${crypto.randomUUID()}`,
                name: search,
                input: { query: `+skills ${action}`, max_results: 5 }
              }
            : { type: 'text', text: `MCP_SKILL_MISSING_TOOL: ${tools.join(',')}` }
        }
      }
      turns.push({ tools, action })
      respond(res, body, content)
    })().catch((error) => {
      res
        .writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { type: 'api_error', message: String(error) } }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a TCP port')
  return {
    fixture,
    turns,
    baseUrl: `http://127.0.0.1:${address.port}`,
    setServerId(value: string) {
      serverId = value
    },
    async close() {
      await handler.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
