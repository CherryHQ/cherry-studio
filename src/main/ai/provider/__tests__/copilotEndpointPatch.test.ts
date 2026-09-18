import { createRequire } from 'node:module'

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { createGitHubCopilotOpenAICompatible } from '@opeoginni/github-copilot-openai-compatible'
import { describe, expect, it } from 'vitest'

const copilotCjs = createRequire(import.meta.url)('@opeoginni/github-copilot-openai-compatible') as {
  createGitHubCopilotOpenAICompatible: typeof createGitHubCopilotOpenAICompatible
}

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

describe.each([
  ['ESM', createGitHubCopilotOpenAICompatible],
  ['CJS', copilotCjs.createGitHubCopilotOpenAICompatible]
] as const)('Copilot endpoint patch (%s)', (_format, createCopilot) => {
  it.each([
    ['gpt-6-astra', '/responses'],
    ['gpt-5', '/responses'],
    ['gpt-5.4', '/responses'],
    ['gpt-5.3-codex', '/responses'],
    ['gpt-4o', '/chat/completions'],
    ['claude-sonnet-4', '/chat/completions'],
    ['gemini-2.5-pro', '/chat/completions']
  ])('sends %s to %s with the matching request format', async (modelId, endpoint) => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> = {}
    const model = createCopilot({
      apiKey: 'copilot-test-token',
      fetch: async (input, init) => {
        requestUrl = String(input)
        requestBody = JSON.parse(init?.body as string)
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }
    }).languageModel(modelId)

    const result = await model.doStream({ prompt })
    await result.stream.cancel()

    expect(requestUrl).toBe(`https://api.githubcopilot.com${endpoint}`)
    expect(requestBody).toMatchObject({ model: modelId, stream: true })
    if (endpoint === '/responses') {
      expect(requestBody.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }])
      expect(requestBody).not.toHaveProperty('messages')
    } else {
      expect(requestBody.messages).toEqual([{ role: 'user', content: 'Hello' }])
      expect(requestBody).not.toHaveProperty('input')
    }
  })
})
