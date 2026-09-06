import type { ServingCredentialReceipt } from '@main/ai/provider/credential'
import { describe, expect, it } from 'vitest'

import { resolveApiKeyFallbacks } from '../resolveApiKeyFallbacks'

const selected: ServingCredentialReceipt = {
  attribution: 'explicit',
  id: 'key-2',
  masked: 'sk-2****2222'
}

describe('resolveApiKeyFallbacks', () => {
  it('continues round-robin after the selected key and excludes disabled keys', () => {
    const keys = [
      { id: 'key-1', key: 'sk-1', isEnabled: true },
      { id: 'disabled', key: 'sk-disabled', isEnabled: false },
      { id: 'key-2', key: 'sk-2', isEnabled: true },
      { id: 'key-3', key: 'sk-3', isEnabled: true }
    ]

    expect(resolveApiKeyFallbacks(keys, selected)).toEqual([
      { id: 'key-3', key: 'sk-3', isEnabled: true },
      { id: 'key-1', key: 'sk-1', isEnabled: true }
    ])
  })

  it('does not rotate an explicit per-request override', () => {
    const keys = [
      { id: 'key-1', key: 'sk-1', isEnabled: true },
      { id: 'key-2', key: 'sk-2', isEnabled: true }
    ]

    expect(resolveApiKeyFallbacks(keys, selected, 'sk-2')).toEqual([])
  })

  it('does not guess a next key when the serving credential is unknown', () => {
    const keys = [
      { id: 'key-1', key: 'sk-1', isEnabled: true },
      { id: 'key-2', key: 'sk-2', isEnabled: true }
    ]

    expect(resolveApiKeyFallbacks(keys, { attribution: 'unknown' })).toEqual([])
  })
})
