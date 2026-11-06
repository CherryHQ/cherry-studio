import { parse } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { application } from '@application'

import { readNativeModelConfig, updateNativeModelConfig } from '../nativeModelConfig'

describe('native model defaults', () => {
  it('persists Poolside native defaults without replacing the saved account or other agent servers', () => {
    const original =
      '# keep\npool:\n  api_url: https://native.test/v1\nagent_servers:\n  other:\n    command: other-agent\n'
    const saved = updateNativeModelConfig('poolside-settings', original, 'poolside/laguna-xs-2.1')
    expect(readNativeModelConfig('poolside-settings', saved)).toBe('poolside/laguna-xs-2.1')
    expect(parseYaml(saved)).toMatchObject({
      pool: { api_url: 'https://native.test/v1', default_agent_server: 'Poolside' },
      agent_servers: { Poolside: { command: 'pool', args: ['acp'] }, other: { command: 'other-agent' } }
    })
    expect(saved).toContain('# keep')
    const cleared = updateNativeModelConfig('poolside-settings', saved)
    expect(readNativeModelConfig('poolside-settings', cleared)).toBeUndefined()
    expect(parseYaml(cleared).pool.api_url).toBe('https://native.test/v1')
  })

  it.each(['kilo-config', 'copilot-settings'] as const)(
    'persists and clears %s without dropping JSONC settings',
    (target) => {
      const saved = updateNativeModelConfig(target, '{\n// retain\n"theme":"dark"\n}', 'custom/model')
      expect(readNativeModelConfig(target, saved)).toBe('custom/model')
      expect(saved).toContain('// retain')
      expect(parse(updateNativeModelConfig(target, saved))).toEqual({ theme: 'dark' })
    }
  )

  it('updates Droid session defaults while preserving custom models and effort', () => {
    const saved = updateNativeModelConfig(
      'factory-settings',
      '{"sessionDefaultSettings":{"reasoningEffort":"high"},"customModels":[{"model":"custom"}]}',
      'custom:custom'
    )
    expect(readNativeModelConfig('factory-settings', saved)).toBe('custom:custom')
    expect(JSON.parse(updateNativeModelConfig('factory-settings', saved))).toEqual({
      sessionDefaultSettings: { reasoningEffort: 'high' },
      customModels: [{ model: 'custom' }]
    })
  })

  it('persists a Vibe alias without removing the provider or its model presets', () => {
    const saved = updateNativeModelConfig(
      'vibe-config',
      '[[models]]\nname="model"\nprovider="custom"\n',
      'custom-alias'
    )
    expect(readNativeModelConfig('vibe-config', saved)).toBe('custom-alias')
    expect(toml.parse(updateNativeModelConfig('vibe-config', saved))).toEqual({
      models: [{ name: 'model', provider: 'custom' }]
    })
  })
  it('saves and clears CodeBuddy defaults while retaining other settings', () => {
    const saved = updateNativeModelConfig('codebuddy-settings', '{"theme":"dark"}', 'test-model')
    expect(JSON.parse(saved)).toEqual({ theme: 'dark', model: 'test-model' })
    expect(JSON.parse(updateNativeModelConfig('codebuddy-settings', saved))).toEqual({ theme: 'dark' })
  })

  it('keeps credentials and JSONC comments when selecting a Claude model', () => {
    const text = updateNativeModelConfig(
      'claude-settings',
      '{\n// keep my settings\n"env":{"ANTHROPIC_AUTH_TOKEN":"secret","ANTHROPIC_MODEL":"old"},"permissions":{"defaultMode":"default"}\n}',
      'sonnet'
    )
    expect(text).toContain('// keep my settings')
    expect(parse(text)).toEqual({
      model: 'sonnet',
      env: { ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_MODEL: 'sonnet' },
      permissions: { defaultMode: 'default' }
    })
  })

  it('saves Pi provider and full model ID without splitting nested model names', () => {
    const saved = updateNativeModelConfig('pi-settings', '{"theme":"dark"}', 'openrouter/anthropic/claude-sonnet-4.6')
    expect(JSON.parse(saved)).toEqual({
      theme: 'dark',
      defaultProvider: 'openrouter',
      defaultModel: 'anthropic/claude-sonnet-4.6'
    })
    expect(() => updateNativeModelConfig('pi-settings', '{}', 'model-without-provider')).toThrow()
  })

  it('preserves Codex provider definitions and permissions', () => {
    const saved = updateNativeModelConfig(
      'codex-config',
      'model = "old"\nmodel_provider = "custom"\n[model_providers.custom]\nbase_url = "https://example.com/v1"\n',
      'new'
    )
    expect(toml.parse(saved)).toEqual({
      model: 'new',
      model_provider: 'custom',
      model_providers: { custom: { base_url: 'https://example.com/v1' } }
    })
  })

  it('changes the Hermes default without dropping provider or other configuration', () => {
    const saved = updateNativeModelConfig(
      'hermes-config',
      '# retained\nmodel:\n  provider: custom\n  default: old\n',
      'new'
    )
    expect(saved).toContain('# retained')
    expect(parseYaml(saved)).toEqual({ model: { provider: 'custom', default: 'new' } })
  })

  it.each([
    ['claude-settings', '{ broken'],
    ['pi-settings', '[]'],
    ['codex-config', 'model = ['],
    ['hermes-config', 'model: [']
  ] as const)('rejects malformed %s instead of replacing the existing settings', (target, content) => {
    expect(() => updateNativeModelConfig(target, content, 'new')).toThrow()
  })

  it('reports invalid native configuration in the current app language', async () => {
    const preferences = application.get('PreferenceService')
    const previous = preferences.get('app.language')
    await preferences.set('app.language', 'zh-CN')
    try {
      expect(() => updateNativeModelConfig('opencode-config', '{ broken', 'next')).toThrow(/JSON.*配置/)
      expect(() => updateNativeModelConfig('codex-config', 'model = [', 'next')).toThrow(/TOML.*配置/)
      expect(() => updateNativeModelConfig('hermes-config', 'model: [', 'next')).toThrow(/YAML.*配置/)
    } finally {
      await preferences.set('app.language', previous)
    }
  })
})
