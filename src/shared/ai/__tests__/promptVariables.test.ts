import { describe, expect, it, vi } from 'vitest'

import {
  containsSupportedVariables,
  type PromptVariableSources,
  replacePromptVariables
} from '@shared/ai/promptVariables'

const sources = (overrides: Partial<PromptVariableSources> = {}): PromptVariableSources => ({
  username: () => 'Ada',
  system: () => 'mac',
  language: () => 'en-US',
  arch: () => 'arm64',
  ...overrides
})

describe('replacePromptVariables', () => {
  it('fills every sourced variable and the model name', async () => {
    const result = await replacePromptVariables(
      '{{username}} on {{system}}/{{arch}} speaks {{language}} to {{model_name}}',
      'Model-X',
      sources()
    )
    expect(result).toBe('Ada on mac/arm64 speaks en-US to Model-X')
  })

  it('uses the fallback and reports the error when a source fails', async () => {
    const onError = vi.fn()
    const result = await replacePromptVariables(
      'System: {{system}}, Arch: {{arch}}',
      undefined,
      sources({
        system: () => Promise.reject(new Error('ipc down')),
        arch: () => {
          throw new Error('no arch')
        },
        onError
      })
    )
    expect(result).toBe('System: Unknown System, Arch: Unknown Architecture')
    expect(onError.mock.calls.map(([variable]) => variable)).toEqual(['{{system}}', '{{arch}}'])
  })

  it('uses the fallback when a source has no value', async () => {
    const result = await replacePromptVariables(
      '{{username}} {{language}} {{model_name}}',
      undefined,
      sources({ username: () => '', language: () => null })
    )
    expect(result).toBe('Unknown Username Unknown System Language Unknown Model')
  })

  it('does not read sources for variables the prompt does not use', async () => {
    const system = vi.fn(() => 'mac')
    await replacePromptVariables('Hello {{username}}', undefined, sources({ system }))
    expect(system).not.toHaveBeenCalled()
  })

  it('replaces every occurrence of a variable', async () => {
    expect(await replacePromptVariables('{{username}} and {{username}}', undefined, sources())).toBe('Ada and Ada')
  })
})

describe('containsSupportedVariables', () => {
  it('detects a supported variable and ignores unknown ones', () => {
    expect(containsSupportedVariables('Today is {{date}}')).toBe(true)
    expect(containsSupportedVariables('Hello {{nickname}}')).toBe(false)
  })
})
