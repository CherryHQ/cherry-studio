import { parse } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { updateNativeModelConfig } from '../nativeModelConfig'

describe('native model defaults', () => {
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
})
