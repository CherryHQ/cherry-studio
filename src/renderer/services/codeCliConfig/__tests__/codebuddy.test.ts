import { describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { Provider } from '@shared/data/types/provider'

import { codebuddyAdapter } from '../codebuddy'
import type { CliConfigFileDraft, ResolvedCliConfigContext } from '../types'

const files = (models: unknown[] = []): CliConfigFileDraft[] => [
  {
    target: 'codebuddy-settings',
    label: 'settings',
    path: '/test/settings.json',
    language: 'json',
    content: '{"theme":"dark"}'
  },
  {
    target: 'codebuddy-models',
    label: 'models',
    path: '/test/models.json',
    language: 'json',
    content: JSON.stringify({ models, other: true })
  }
]
const context: ResolvedCliConfigContext = {
  provider: {
    name: 'Test',
    endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://example.com/v1' } }
  } as Provider,
  model: 'test-model',
  apiKey: 'test-key',
  modelRecord: null,
  configBlob: {}
}

describe('CodeBuddy model configuration', () => {
  it('writes a usable native model and preserves unrelated models and settings', async () => {
    const user = { id: 'user-model', url: 'https://user.example/v1/chat/completions' }
    const draft = await codebuddyAdapter.buildDraft(
      { cliTool: 'codebuddy-code', modelId: 'test::model', files: files([user]) },
      context
    )
    const settings = JSON.parse(draft.find((f) => f.target === 'codebuddy-settings')!.content)
    const models = JSON.parse(draft.find((f) => f.target === 'codebuddy-models')!.content)
    expect(settings).toEqual({ theme: 'dark', model: 'test-model' })
    expect(models.other).toBe(true)
    expect(models.models).toEqual([
      user,
      expect.objectContaining({
        id: settings.model,
        apiKey: 'test-key',
        url: 'https://example.com/v1/chat/completions',
        api: 'openai-completions'
      })
    ])
    const updated = await codebuddyAdapter.buildDraft(
      { cliTool: 'codebuddy-code', modelId: 'test::other', files: draft },
      { ...context, model: 'other-model' }
    )
    expect(JSON.parse(updated[0].content).models.map((m: { id: string }) => m.id)).toEqual([
      'user-model',
      'other-model'
    ])
  })

  it('clears only Cherry-created models when returning to a native model', async () => {
    const user = { id: 'user-model', apiKey: 'user-key' }
    const request = vi.spyOn(ipcApi, 'request').mockResolvedValue({
      files: [
        { target: 'codebuddy-settings', path: '/test/settings.json', content: '{"theme":"dark"}' },
        {
          target: 'codebuddy-models',
          path: '/test/models.json',
          content: JSON.stringify({ other: true, models: [user, { id: 'managed', 'x-cherry-studio': true }] })
        }
      ]
    })
    try {
      const cleared = await codebuddyAdapter.buildClearFiles()
      expect(cleared).toHaveLength(1)
      expect(JSON.parse(cleared[0].content!)).toEqual({ other: true, models: [user] })
    } finally {
      request.mockRestore()
    }
  })

  it('does not overwrite a user model with the same upstream ID', async () => {
    await expect(
      codebuddyAdapter.buildDraft(
        { cliTool: 'codebuddy-code', modelId: 'test::model', files: files([{ id: 'test-model' }]) },
        context
      )
    ).rejects.toThrow('already has a custom model')
  })

  it('uses the Responses base URL without appending chat/completions', async () => {
    const draft = await codebuddyAdapter.buildDraft(
      { cliTool: 'codebuddy-code', modelId: 'test::model', files: files() },
      {
        ...context,
        provider: {
          ...context.provider,
          endpointConfigs: { 'openai-responses': { baseUrl: 'https://example.com/v1' } }
        }
      }
    )
    expect(JSON.parse(draft[0].content).models[0]).toMatchObject({
      api: 'openai-responses',
      url: 'https://example.com/v1'
    })
  })
})
