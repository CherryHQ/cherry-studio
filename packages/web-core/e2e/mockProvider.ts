import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// OpenAI-compatible chat-completions endpoint for the chat tests, run by Playwright's webServer.
// It replies `echo: <last user text>` in three stream chunks, answers 401 to "please fail" and
// never finishes a reply to "please hang". To `call <tool> <json args>` (repeatable) it answers with
// those tool calls, then replies `tools said: <results>` once the results come back.
// `GET /requests` returns what it received so tests can check what the browser sent.
export const MOCK_PROVIDER_PORT = 4319

interface ChatRequest {
  model: string
  stream?: boolean
  messages: { role: string; content: string | { type: string; text?: string }[] | null }[]
}

const received: { authorization?: string; body: ChatRequest }[] = []

function textOf(content: ChatRequest['messages'][number]['content']): string {
  return typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('')
}

function lastUserText(body: ChatRequest): string {
  return textOf(body.messages.findLast((message) => message.role === 'user')?.content ?? '')
}

/** Results of the tool calls answered since the last user message. */
function toolResults(body: ChatRequest): string[] {
  const lastUser = body.messages.findLastIndex((message) => message.role === 'user')
  return body.messages
    .slice(lastUser + 1)
    .filter((message) => message.role === 'tool')
    .map((message) => textOf(message.content))
}

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  const payload = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model }
  return `data: ${JSON.stringify({ ...payload, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
}

async function handleChat(request: IncomingMessage, response: ServerResponse) {
  let raw = ''
  for await (const part of request) raw += part
  const body = JSON.parse(raw) as ChatRequest
  received.push({ authorization: request.headers.authorization, body })
  const text = lastUserText(body)
  if (text.includes('please fail')) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ error: { message: 'mock provider rejected the key', type: 'invalid_request_error' } })
    )
    return
  }
  const calls = [...text.matchAll(/call (\w+) (\{.*?\})(?= call |$)/gs)]
  const results = toolResults(body)
  if (calls.length && !results.length && body.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const toolCalls = calls.map(([, name, args], index) => ({
      index,
      id: `call_${index}_${Date.now()}`,
      type: 'function',
      function: { name, arguments: args }
    }))
    response.write(chunk(body.model, { role: 'assistant', content: null, tool_calls: toolCalls }))
    response.write(chunk(body.model, {}, 'tool_calls'))
    response.end('data: [DONE]\n\n')
    return
  }
  const reply = results.length ? `tools said: ${results.join(' | ')}` : `echo: ${text}`
  if (!body.stream) {
    response.writeHead(200, { 'content-type': 'application/json' })
    const message = { role: 'assistant', content: reply }
    response.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [{ index: 0, message, finish_reason: 'stop' }]
      })
    )
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  response.write(chunk(body.model, { role: 'assistant', content: '' }))
  if (text.includes('please hang')) {
    response.write(chunk(body.model, { content: 'partial' }))
    return
  }
  for (const piece of [reply.slice(0, 4), reply.slice(4, 8), reply.slice(8)]) {
    response.write(chunk(body.model, { content: piece }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  response.write(chunk(body.model, {}, 'stop'))
  response.end('data: [DONE]\n\n')
}

function startMockProvider() {
  createServer((request, response) => {
    // The Worker calls from another origin, so the endpoint must answer CORS like a real provider.
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', request.headers['access-control-request-headers'] ?? '*')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
    } else if (request.method === 'GET' && request.url === '/requests') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(received))
    } else if (request.method === 'GET') {
      response.writeHead(200).end('mock provider')
    } else if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      handleChat(request, response).catch((error: Error) => response.writeHead(400).end(error.message))
    } else {
      response.writeHead(404).end()
    }
  }).listen(MOCK_PROVIDER_PORT)
}

// The Playwright config and specs import the port; only `node e2e/mockProvider.ts` starts it.
if (import.meta.main) startMockProvider()
