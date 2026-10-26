import { once } from 'node:events'
import { createServer } from 'node:http'

export async function startTranslationSettingsServer() {
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }>; stream?: boolean }> = []
  const inputs = [
    '今天阳光明媚，我们一起去公园散步，欣赏美丽的花朵。',
    '明天天气晴朗，我们准备一起去图书馆阅读有趣的书籍。',
    '周末我们计划去博物馆参观，了解这座城市悠久的历史。'
  ]
  const answers = [
    'It is sunny today. Let us walk in the park and enjoy the beautiful flowers.',
    'The weather will be fine tomorrow. We plan to read interesting books at the library.',
    'This weekend we plan to visit the museum and learn about the long history of this city.'
  ]
  // This fixture exercises real HTTP, IPC, persistence and usage recording; it does not assess model quality.
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as (typeof requests)[number]
    requests.push(body)
    const detection = body.messages.some((message) => message.content.includes('precisely identify the language'))
    const inputIndex = inputs.findIndex((input) => JSON.stringify(body.messages).includes(input))
    if (inputIndex === -1) {
      res.writeHead(400).end(JSON.stringify({ error: { message: 'Unexpected translation input' } }))
      return
    }
    const text = detection ? 'zh-cn' : answers[inputIndex]
    const metadata = { id: `mp86-${requests.length}`, model: body.model, created: Math.floor(Date.now() / 1000) }
    const usage = detection
      ? { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 }
      : { prompt_tokens: 29, completion_tokens: 11, total_tokens: 40 }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      for (const chunk of [
        { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage }
      ]) {
        res.write(`data: ${JSON.stringify({ ...metadata, object: 'chat.completion.chunk', ...chunk })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          ...metadata,
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage
        })
      )
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Translation fixture did not bind a port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    inputs,
    answers,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
  }
}
