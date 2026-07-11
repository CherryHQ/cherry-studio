import { CLI_API_GATEWAY_PROVIDER_ID } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { cliProviderKeyName, safeCreateUniqueModelId } from '../values'

describe('safeCreateUniqueModelId', () => {
  it('builds a unique model id from valid parts', () => {
    expect(safeCreateUniqueModelId('anthropic', 'claude-4')).toBe('anthropic::claude-4')
  })

  it('returns undefined instead of throwing on empty parts', () => {
    expect(safeCreateUniqueModelId('', 'claude-4')).toBeUndefined()
    expect(safeCreateUniqueModelId('anthropic', '')).toBeUndefined()
  })

  it('returns undefined when providerId contains the separator', () => {
    expect(safeCreateUniqueModelId('anthropic::x', 'claude-4')).toBeUndefined()
  })

  it('returns undefined when modelId contains a reserved route character', () => {
    expect(safeCreateUniqueModelId('anthropic', 'claude?4')).toBeUndefined()
    expect(safeCreateUniqueModelId('anthropic', 'claude#4')).toBeUndefined()
  })
})

describe('cliProviderKeyName', () => {
  it('uses the fixed "gateway" name for the synthetic gateway (→ clean cherry-gateway key)', () => {
    // The card title "Cherry 网关" would otherwise sanitize to the ugly "Cherry-".
    expect(cliProviderKeyName({ id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Cherry 网关' })).toBe('gateway')
  })

  it('derives real providers from their sanitized display name (unchanged behavior)', () => {
    expect(cliProviderKeyName({ id: 'deepseek', name: 'DeepSeek' })).toBe('DeepSeek')
    expect(cliProviderKeyName({ id: 'x', name: 'Foo Bar' })).toBe('Foo-Bar')
  })
})
