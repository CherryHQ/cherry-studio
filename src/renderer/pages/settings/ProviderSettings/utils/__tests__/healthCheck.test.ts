import type { ApiKeyEntry } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { resolveModelCheckCredentials } from '../../utils/healthCheck'

const entries: ApiKeyEntry[] = [
  { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
  { id: 'key-2', key: 'sk-disabled', label: 'Disabled', isEnabled: false },
  { id: 'key-3', key: 'sk-backup', label: 'Backup', isEnabled: true }
]

describe('resolveModelCheckCredentials', () => {
  it('keeps stable identity while selecting all enabled API keys', () => {
    expect(resolveModelCheckCredentials(entries, { mode: 'all' }, true)).toEqual([
      { kind: 'api-key', entry: entries[0] },
      { kind: 'api-key', entry: entries[2] }
    ])
  })

  it('selects one enabled API key by stable id', () => {
    expect(resolveModelCheckCredentials(entries, { mode: 'single', keyId: 'key-3' }, true)).toEqual([
      { kind: 'api-key', entry: entries[2] }
    ])
  })

  it('rejects missing or disabled selected keys with a mappable error code', () => {
    try {
      resolveModelCheckCredentials(entries, { mode: 'single', keyId: 'key-2' }, true)
      expect.unreachable('expected unavailable API key to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ code: 'api_key_unavailable' })
    }
  })

  it('rejects providers that require a key when none are enabled', () => {
    try {
      resolveModelCheckCredentials([], { mode: 'all' }, true)
      expect.unreachable('expected a required API key error')
    } catch (error) {
      expect(error).toMatchObject({ code: 'api_key_required' })
    }
  })

  it('uses provider authentication when a generic API key is not required', () => {
    expect(resolveModelCheckCredentials([], { mode: 'all' }, false)).toEqual([
      { kind: 'provider-auth', id: 'provider-auth', key: '' }
    ])
  })
})
