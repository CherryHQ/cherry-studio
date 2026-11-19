import { createRequire } from 'node:module'

import { type LanguageModelV3CallOptions, NoSuchModelError } from '@ai-sdk/provider'
import type { GitHubCopilotProviderSettings } from '@opeoginni/github-copilot-openai-compatible'
import { createGitHubCopilotOpenAICompatible } from '@opeoginni/github-copilot-openai-compatible'
import { createProviderRegistry } from 'ai'
import { describe, expect, it } from 'vitest'

import { GitHubCopilotExtension } from '../extensions'

const copilotCjs = createRequire(import.meta.url)('@opeoginni/github-copilot-openai-compatible') as {
  createGitHubCopilotOpenAICompatible: typeof createGitHubCopilotOpenAICompatible
}

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

describe.each([
  ['ESM', createGitHubCopilotOpenAICompatible],
  ['CJS', copilotCjs.createGitHubCopilotOpenAICompatible],
  ['Cherry extension', (settings: GitHubCopilotProviderSettings) => GitHubCopilotExtension.createProvider(settings)]
] as const)('Copilot endpoint patch (%s)', (_format, createCopilot) => {
  it.each([
    ['gpt-6-astra', '/responses'],
    ['gpt-6-sol', '/responses'],
    ['gpt-6-luna', '/responses'],
    ['gpt-5', '/responses'],
    ['gpt-5.4', '/responses'],
    ['gpt-5.3-codex', '/responses'],
    ['gpt-4o', '/chat/completions'],
    ['claude-sonnet-4', '/chat/completions'],
    ['gemini-2.5-pro', '/chat/completions']
  ])('sends %s to %s with the matching request format', async (modelId, endpoint) => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> = {}
    const provider = await createCopilot({
      apiKey: 'copilot-test-token',
      fetch: async (input, init) => {
        requestUrl = String(input)
        requestBody = JSON.parse(init?.body as string)
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }
    })
    const model = provider.languageModel(modelId)

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

it.each(['embeddingModel', 'imageModel'] as const)(
  'rejects unsupported Copilot %s through the SDK contract',
  async (modelType) => {
    const provider = await GitHubCopilotExtension.createProvider({ apiKey: 'copilot-test-token' })
    const registry = createProviderRegistry({ copilot: provider })
    const createUnsupportedModel = () =>
      modelType === 'embeddingModel'
        ? registry.embeddingModel('copilot:unsupported-model')
        : registry.imageModel('copilot:unsupported-model')

    expect(createUnsupportedModel).toThrow(NoSuchModelError)
    expect(createUnsupportedModel).toThrow(expect.objectContaining({ modelId: 'unsupported-model', modelType }))
  }
)
