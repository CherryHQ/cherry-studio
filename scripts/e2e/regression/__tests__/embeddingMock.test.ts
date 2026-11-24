import { createOpenAI } from '@ai-sdk/openai'
import { embed, embedMany } from 'ai'

import { EMBEDDING_MODEL, startEmbeddingMock } from '../embeddingMock'

let mock: Awaited<ReturnType<typeof startEmbeddingMock>>
beforeEach(async () => {
  mock = await startEmbeddingMock()
})
afterEach(async () => {
  await mock.close()
})

const similarity = (left: number[], right: number[]) =>
  left.reduce((sum, value, index) => sum + value * right[index], 0) / (Math.hypot(...left) * Math.hypot(...right))

it.each([
  {
    query: 'What is the regression knowledge answer?',
    source: 'The regression knowledge answer is CHERRY_KNOWLEDGE_58597. Its source file is ground-truth.txt.',
    distractor: 'This file contains unrelated background and no regression answer.'
  },
  {
    query: '公开测试标记是什么',
    source: '本项目的公开测试标记是 canary-seven。这是完全虚构的公开回归测试数据。',
    distractor: '这一节只记录回归测试的背景信息。以上说明与公开测试标记无关，只用于填充分块数量。'
  }
])(
  'ranks the source above distractors for $query across batch and single requests',
  async ({ query, source, distractor }) => {
    const model = createOpenAI({ baseURL: mock.baseUrl, apiKey: mock.apiKey }).embedding(EMBEDDING_MODEL)
    const { embeddings } = await embedMany({ model, values: [distractor, source] })
    const { embedding } = await embed({ model, value: query })
    expect(embeddings).toHaveLength(2)
    expect(embedding.length).toBeGreaterThan(0)
    expect(embeddings.every((vector) => vector.length === embedding.length && vector.every(Number.isFinite))).toBe(true)
    expect(similarity(embedding, embeddings[1])).toBeGreaterThan(0.99)
    expect(similarity(embedding, embeddings[0])).toBeLessThan(0.7)
    const repeated = await embed({ model, value: source })
    expect(repeated.embedding).toEqual(embeddings[1])
  }
)

it.each([{ input: 42, model: EMBEDDING_MODEL }, { input: 'test', model: 'wrong-model' }, { model: EMBEDDING_MODEL }])(
  'rejects invalid embedding requests without stopping the service',
  async (body) => {
    const request = (body: unknown) =>
      fetch(`${mock.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    expect((await request(body)).status).toBe(400)
    expect((await request({ input: 'test', model: EMBEDDING_MODEL })).status).toBe(200)
  }
)

it('releases its listener when closed', async () => {
  await Promise.all([mock.close(), mock.close()])
  await expect(fetch(`${mock.baseUrl}/embeddings`)).rejects.toThrow()
})
