import { once } from 'node:events'
import { createServer } from 'node:http'

import { buildEmbeddingResponse, generateDeterministicEmbedding } from '@copilotkit/aimock'
import * as z from 'zod'

export const EMBEDDING_MODEL = 'cherry-e2e-mock-embedding'
export const EMBEDDING_DATA_SOURCE =
  'Loopback mock embedding vectors; real application indexing and retrieval. Fixture similarity does not validate embedding model quality.'

export interface EmbeddingProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const requestSchema = z.object({
  model: z.literal(EMBEDDING_MODEL),
  input: z.union([z.string(), z.array(z.string()).min(1)])
})

function embedding(text: string): number[] {
  // Canonical fixture topics make queries match their source chunks while distractors stay distinct.
  const topic = /regression knowledge answer|CHERRY_KNOWLEDGE_58597/i.test(text)
    ? 'regression knowledge answer'
    : /公开测试标记是什么|canary-seven/.test(text)
      ? 'public canary marker'
      : text
  return generateDeterministicEmbedding(topic, 64)
}

export async function startEmbeddingMock() {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const { model, input } = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const inputs = typeof input === 'string' ? [input] : input
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(buildEmbeddingResponse(inputs.map(embedding), model)))
    })().catch(() => response.writeHead(400).end(JSON.stringify({ error: { message: 'Invalid embedding request' } })))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Embedding mock did not bind a TCP port')
  let closing: Promise<void> | undefined
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'mock-embedding-key',
    model: EMBEDDING_MODEL,
    close: () => {
      if (!closing) {
        closing = new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        server.closeAllConnections()
      }
      return closing
    }
  }
}
