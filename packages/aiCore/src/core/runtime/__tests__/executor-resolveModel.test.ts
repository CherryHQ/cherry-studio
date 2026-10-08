import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

import { RuntimeExecutor } from '../executor'

// Reusing an executor must not retain a resolver for the previous operation's modality.
describe('RuntimeExecutor model routing', () => {
  it.each(['text-first', 'image-first'])(
    'routes text, image and embedding calls on one executor (%s)',
    async (order) => {
      const requests: Array<{ path: string; body: Record<string, any> }> = []
      const provider = createOpenAI({
        apiKey: 'test',
        fetch: async (url, init) => {
          const path = new URL(String(url)).pathname
          requests.push({ path, body: JSON.parse(String(init?.body)) })
          if (path.endsWith('/images/generations')) return Response.json({ created: 0, data: [{ b64_json: 'QUJD' }] })
          if (path.endsWith('/embeddings'))
            return Response.json({
              data: [{ index: 0, embedding: [0.1, 0.9] }],
              usage: { prompt_tokens: 3, total_tokens: 3 }
            })
          return Response.json({
            id: 'chat-1',
            model: 'tenant:model',
            created: 0,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }]
          })
        }
      })
      const executor = RuntimeExecutor.create('openai', provider, {}, [], (id) => provider.chat(id))
      const text = () => executor.generateText({ model: 'tenant:model', prompt: 'Hello' })
      const image = () => executor.generateImage({ model: 'gpt-image-1', prompt: 'A cherry' })
      if (order === 'text-first') {
        expect((await text()).text).toBe('Hello')
        expect((await image()).image.base64).toBe('QUJD')
      } else {
        expect((await image()).image.base64).toBe('QUJD')
        expect((await text()).text).toBe('Hello')
      }
      const embedding = await executor.embedMany({ model: 'text-embedding-3-small', values: ['cherry'] })
      expect(embedding.embeddings).toEqual([[0.1, 0.9]])
      expect(embedding.usage).toEqual({ tokens: 3 })
      expect(requests.find(({ path }) => path.endsWith('/chat/completions'))?.body.model).toBe('tenant:model')
      expect(requests.find(({ path }) => path.endsWith('/images/generations'))?.body.model).toBe('gpt-image-1')
      expect(requests.find(({ path }) => path.endsWith('/embeddings'))?.body).toMatchObject({
        model: 'text-embedding-3-small',
        input: ['cherry']
      })
    }
  )
})
