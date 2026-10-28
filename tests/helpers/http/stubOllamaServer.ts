import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type StubOllamaModel = {
  name: string
  /** `/api/tags` capabilities. Defaults to completion+tools+thinking. */
  capabilities?: string[]
  /** Top-level `thinking` of `/api/show`; omit to model a daemon that reports nothing. */
  thinking?: { values: Array<string | boolean>; default?: string | boolean }
}

export type StubOllamaServer = {
  readonly baseUrl: string
  readonly chatBodies: Array<Record<string, unknown>>
  readonly rejectedChats: string[]
  readonly showCalls: string[]
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function startStubOllamaServer(models: StubOllamaModel[]): Promise<StubOllamaServer> {
  const chatBodies: Array<Record<string, unknown>> = []
  const rejectedChats: string[] = []
  const showCalls: string[] = []

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && url.startsWith('/api/tags')) {
      sendJson(res, 200, {
        models: models.map((model) => ({
          name: model.name,
          model: model.name,
          modified_at: '2026-10-22T00:00:00Z',
          size: 1024,
          digest: 'stub',
          details: { family: 'qwen3', parameter_size: '27B', quantization_level: 'Q4_K_M' },
          capabilities: model.capabilities ?? ['completion', 'tools', 'thinking']
        }))
      })
      return
    }

    if (req.method === 'POST' && url.startsWith('/api/show')) {
      const body = JSON.parse((await readBody(req)) || '{}') as { model?: string }
      showCalls.push(body.model ?? '')
      const model = models.find((candidate) => candidate.name === body.model)
      if (!model) {
        sendJson(res, 404, { error: `unknown model ${body.model}` })
        return
      }
      sendJson(res, 200, {
        license: 'stub',
        modelfile: 'stub',
        parameters: '',
        template: 'stub',
        details: { family: 'qwen3', parameter_size: '27B', quantization_level: 'Q4_K_M' },
        model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 32768 },
        capabilities: model.capabilities ?? ['completion', 'tools', 'thinking'],
        ...(model.thinking ? { thinking: model.thinking } : {})
      })
      return
    }

    if (req.method === 'POST' && url.startsWith('/api/chat')) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
      const model = models.find((candidate) => candidate.name === body.model)
      if (!model) {
        rejectedChats.push(`unknown model ${String(body.model)}`)
        sendJson(res, 404, { error: `unknown model ${String(body.model)}` })
        return
      }
      if (Object.hasOwn(body, 'think')) {
        const allowed = model.thinking?.values
        const value = body.think
        const ok = allowed ? allowed.includes(value as string | boolean) : false
        if (!ok) {
          rejectedChats.push(`${model.name}: unadvertised think ${JSON.stringify(value)}`)
          sendJson(res, 400, { error: `stub rejects think ${JSON.stringify(value)} for ${model.name}` })
          return
        }
      }
      chatBodies.push(body)
      const base = {
        model: body.model,
        created_at: '2026-10-22T00:00:00Z',
        done: true,
        done_reason: 'stop',
        total_duration: 1,
        eval_count: 1
      }
      if (body.stream === false) {
        sendJson(res, 200, { ...base, message: { role: 'assistant', content: 'ok' } })
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' })
      res.flushHeaders()
      res.write(`${JSON.stringify({ ...base, done: false, message: { role: 'assistant', content: 'ok' } })}\n`)
      res.end(`${JSON.stringify({ ...base, message: { role: 'assistant', content: '' } })}\n`)
      return
    }

    sendJson(res, 404, { error: `stub has no route for ${req.method} ${url}` })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    chatBodies,
    rejectedChats,
    showCalls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
