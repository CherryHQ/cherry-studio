import type { LanguageModelV2 } from '@ai-sdk/provider'
import { createMockImageModel, createMockLanguageModel } from '@test-utils'
import { describe, expect, it } from 'vitest'

import { ModelResolutionError } from '../../errors'
import { type AiPlugin, createContext, PluginManager } from '../../plugins'
import { PluginEngine } from '../pluginEngine'

describe('plugin result boundaries', () => {
  it.each([false, 0, ''])('retains the first non-null template result %j', async (value) => {
    const manager = new PluginManager([
      { name: 'first', loadTemplate: () => value },
      {
        name: 'later',
        loadTemplate: () => {
          throw new Error('Later template must not run')
        }
      }
    ])

    expect(await manager.executeFirst('loadTemplate', 'test', createContext('openai', 'test', {}))).toBe(value)
  })

  it.each(['text', 'stream', 'image'] as const)(
    'rejects a resolver returning the wrong modality for %s',
    async (mode) => {
      const language = createMockLanguageModel()
      const image = createMockImageModel()
      const engine = new PluginEngine('openai', [
        { name: 'wrong-modality', resolveModel: () => (mode === 'image' ? language : image) }
      ])
      const execute = () => {
        throw new Error('Wrong-modality executor must not run')
      }
      const result =
        mode === 'image'
          ? engine.executeImageWithPlugins('generateImage', { model: 'test', prompt: 'test' }, execute)
          : mode === 'stream'
            ? engine.executeStreamWithPlugins('streamText', { model: 'test', prompt: 'test' }, execute)
            : engine.executeWithPlugins('generateText', { model: 'test', prompt: 'test' }, execute)

      await expect(result).rejects.toBeInstanceOf(ModelResolutionError)
      if (mode !== 'image') await expect(engine.resolveModel('test')).rejects.toBeInstanceOf(ModelResolutionError)
    }
  )

  it.each(['text', 'stream'] as const)('allows a V2 language model without middleware for %s', async (mode) => {
    const legacy: LanguageModelV2 = {
      specificationVersion: 'v2',
      provider: 'legacy',
      modelId: 'test',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not used by plugin dispatch')
      },
      doStream: async () => {
        throw new Error('Not used by plugin dispatch')
      }
    }
    const engine = new PluginEngine('openai', [{ name: 'legacy', resolveModel: () => legacy }])
    const reachedExecutor = new Error('Legacy model reached native SDK executor')
    const execute = (model: unknown) => {
      expect(model).toBe(legacy)
      throw reachedExecutor
    }
    const result =
      mode === 'stream'
        ? engine.executeStreamWithPlugins('streamText', { model: 'test', prompt: 'test' }, execute)
        : engine.executeWithPlugins('generateText', { model: 'test', prompt: 'test' }, execute)

    await expect(result).rejects.toBe(reachedExecutor)

    const middlewarePlugin: AiPlugin = {
      name: 'middleware',
      configureContext: (context) => {
        context.middlewares = [{ specificationVersion: 'v3' }]
      }
    }
    engine.use(middlewarePlugin)
    const wrapped =
      mode === 'stream'
        ? engine.executeStreamWithPlugins('streamText', { model: 'test', prompt: 'test' }, execute)
        : engine.executeWithPlugins('generateText', { model: 'test', prompt: 'test' }, execute)
    await expect(wrapped).rejects.toBeInstanceOf(ModelResolutionError)
  })

  it.each(['text', 'stream', 'image'] as const)(
    'notifies error hooks and rethrows original rejection values for %s',
    async (mode) => {
      const failures = [new Error('executor failed'), 'rejected', { reason: 'failed' }, null, undefined]

      for (const failure of failures) {
        const observed: unknown[] = []
        const engine = new PluginEngine('openai', [
          {
            name: 'observe',
            onError: (error) => {
              observed.push(error)
            }
          }
        ])
        const execute = () => {
          throw failure
        }
        const result =
          mode === 'image'
            ? engine.executeImageWithPlugins(
                'generateImage',
                { model: createMockImageModel(), prompt: 'test' },
                execute
              )
            : mode === 'stream'
              ? engine.executeStreamWithPlugins(
                  'streamText',
                  { model: createMockLanguageModel(), prompt: 'test' },
                  execute
                )
              : engine.executeWithPlugins('generateText', { model: createMockLanguageModel(), prompt: 'test' }, execute)

        await expect(result).rejects.toBe(failure)
        expect(observed).toHaveLength(failure === undefined ? 0 : 1)
        if (failure !== undefined) expect(observed[0]).toBe(failure)
      }
    }
  )
})
