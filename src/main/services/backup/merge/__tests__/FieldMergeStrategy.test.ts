import type { FieldMergePolicy } from '@main/data/db/backup/contributorTypes'
import { describe, expect, it } from 'vitest'

import { FieldMergeStrategy, FieldMergeStrategyError } from '../strategies/FieldMergeStrategy'

const policy = (column: string, strategy: FieldMergePolicy['strategy']) => ({ column, strategy })

describe('FieldMergeStrategy', () => {
  const strategy = new FieldMergeStrategy()

  it('fills a null local value from the backup without replacing protected keys', () => {
    const merged = strategy.merge({
      localRow: { id: 'local-id', name: 'local-name', description: null },
      remoteRow: { id: 'backup-id', name: 'backup-name', description: 'remote description' },
      policies: [policy('description', 'remote-fills-local-null')],
      protectedColumns: new Set(['id', 'name'])
    })

    expect(merged).toEqual({ id: 'local-id', name: 'local-name', description: 'remote description' })
  })

  it('fills credential skeletons and empty arrays without replacing populated local credentials', () => {
    const merged = strategy.merge({
      localRow: {
        api_keys: '[]',
        auth_config: JSON.stringify({ type: 'api-key' }),
        populated_auth: JSON.stringify({ type: 'oauth', refreshToken: 'local-token' })
      },
      remoteRow: {
        api_keys: JSON.stringify([{ key: 'backup-key' }]),
        auth_config: JSON.stringify({ type: 'oauth', refreshToken: 'backup-token' }),
        populated_auth: JSON.stringify({ type: 'oauth', refreshToken: 'backup-token' })
      },
      policies: [
        policy('api_keys', 'remote-fills-local-empty'),
        policy('auth_config', 'remote-fills-local-empty'),
        policy('populated_auth', 'remote-fills-local-empty')
      ],
      protectedColumns: new Set()
    })

    expect(merged).toMatchObject({
      api_keys: JSON.stringify([{ key: 'backup-key' }]),
      auth_config: JSON.stringify({ type: 'oauth', refreshToken: 'backup-token' }),
      populated_auth: JSON.stringify({ type: 'oauth', refreshToken: 'local-token' })
    })
  })

  it('deep-merges JSON objects with local leaf values taking precedence', () => {
    const merged = strategy.merge({
      localRow: { configuration: JSON.stringify({ local: { enabled: true }, shared: { value: 'local' } }) },
      remoteRow: {
        configuration: JSON.stringify({ remote: { enabled: true }, shared: { value: 'backup', added: 1 } })
      },
      policies: [policy('configuration', 'deep-merge')],
      protectedColumns: new Set()
    })

    expect(JSON.parse(String(merged.configuration))).toEqual({
      local: { enabled: true },
      remote: { enabled: true },
      shared: { value: 'local', added: 1 }
    })
  })

  it('rejects an invalid remote deep-merge value when local configuration is empty', () => {
    expect(() =>
      strategy.merge({
        localRow: { configuration: null },
        remoteRow: { configuration: '["not-an-object"]' },
        policies: [policy('configuration', 'deep-merge')],
        protectedColumns: new Set()
      })
    ).toThrow(FieldMergeStrategyError)
  })

  it('keeps a populated local field but fills a blank local-priority field', () => {
    const merged = strategy.merge({
      localRow: { name: 'local workspace', description: '' },
      remoteRow: { name: 'backup workspace', description: 'backup description' },
      policies: [policy('name', 'local-priority'), policy('description', 'local-priority')],
      protectedColumns: new Set()
    })

    expect(merged).toEqual({ name: 'local workspace', description: 'backup description' })
  })
})
