import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { parseConfiguredModelId, resolveCliConfigApplyContext } from '../applyContext'

describe('parseConfiguredModelId', () => {
  it('parses a well-formed unique model id into its parts', () => {
    expect(parseConfiguredModelId('anthropic::claude-fable-5')).toEqual({
      uniqueModelId: 'anthropic::claude-fable-5',
      providerId: 'anthropic',
      modelId: 'claude-fable-5'
    })
  })

  it.each([null, undefined, '', 'no-separator', '::missing-provider', 'anthropic::'])(
    'returns null for the legacy/corrupt value %j',
    (value) => {
      expect(parseConfiguredModelId(value)).toBeNull()
    }
  )
})

describe('resolveCliConfigApplyContext', () => {
  it('resolves a common model selection with writePrimaryModel', () => {
    expect(
      resolveCliConfigApplyContext(CodeCli.CLAUDE_CODE, 'anthropic', { modelId: 'anthropic::claude-fable-5' })
    ).toEqual({
      modelId: 'anthropic::claude-fable-5',
      providerId: 'anthropic',
      rawModelId: 'claude-fable-5',
      writePrimaryModel: true
    })
  })

  it('prefers the detailed Claude env model over the stored modelId and skips the primary write', () => {
    expect(
      resolveCliConfigApplyContext(CodeCli.CLAUDE_CODE, 'anthropic', {
        modelId: null,
        config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-detailed' } }
      })
    ).toEqual({
      modelId: 'anthropic::claude-detailed',
      providerId: 'anthropic',
      rawModelId: 'claude-detailed',
      writePrimaryModel: false
    })
  })

  it('falls back to the stored modelId when the detailed env value cannot form a unique id', () => {
    expect(
      resolveCliConfigApplyContext(CodeCli.CLAUDE_CODE, 'anthropic', {
        modelId: 'anthropic::claude-fable-5',
        config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude?bad' } }
      })
    ).toEqual({
      modelId: 'anthropic::claude-fable-5',
      providerId: 'anthropic',
      rawModelId: 'claude-fable-5',
      writePrimaryModel: true
    })
  })

  it('ignores Claude detailed env keys for other tools', () => {
    expect(
      resolveCliConfigApplyContext(CodeCli.OPENAI_CODEX, 'deepseek', {
        modelId: 'deepseek::deepseek-chat',
        config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-detailed' } }
      })
    ).toEqual({
      modelId: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      rawModelId: 'deepseek-chat',
      writePrimaryModel: true
    })
  })

  it.each([
    ['own-login placeholder (null)', { modelId: null }],
    ['legacy empty-string sentinel', { modelId: '' }],
    ['missing provider config', undefined]
  ])('returns null when there is no applicable model — %s', (_label, providerConfig) => {
    expect(resolveCliConfigApplyContext(CodeCli.CLAUDE_CODE, 'anthropic', providerConfig)).toBeNull()
  })
})
