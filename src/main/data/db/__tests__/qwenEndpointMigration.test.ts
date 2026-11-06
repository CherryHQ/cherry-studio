import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { replayMigration } from '@test-helpers/db/replayMigration'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { migrateQwenEndpointUrl } from '@data/migration/v2/utils/qwenEndpointUrl'

const changedUrls = [
  ['https://dashscope.aliyuncs.com', 'https://maas.qianwenaiapi.com'],
  ['https://dashscope.aliyuncs.com/compatible-mode/v1/', 'https://maas.qianwenaiapi.com/compatible-mode/v1/'],
  ['https://dashscope-intl.aliyuncs.com/apps/anthropic', 'https://maas.qwencloudapi.com/apps/anthropic'],
  [
    'http://dashscope.aliyuncs.com:8080/api/v1/services/aigc/image-generation/generation',
    'http://maas.qianwenaiapi.com:8080/api/v1/services/aigc/image-generation/generation'
  ],
  [
    'HTTPS://DASHSCOPE-INTL.ALIYUNCS.COM:443/./v1?x=%2F&next=dashscope.aliyuncs.com#',
    'HTTPS://maas.qwencloudapi.com:443/./v1?x=%2F&next=dashscope.aliyuncs.com#'
  ],
  [
    'https://dashscope.aliyuncs.com:000443/v1/chat/completions#',
    'https://maas.qianwenaiapi.com:000443/v1/chat/completions#'
  ],
  [
    'https://user:password@dashscope-intl.aliyuncs.com:65535/v1',
    'https://user:password@maas.qwencloudapi.com:65535/v1'
  ],
  ['https://user@name@dashscope.aliyuncs.com/v1', 'https://user@name@maas.qianwenaiapi.com/v1'],
  ['https://dashscope.aliyuncs.com?x=1', 'https://maas.qianwenaiapi.com?x=1'],
  ['http://dashscope-intl.aliyuncs.com:/v1', 'http://maas.qwencloudapi.com:/v1']
] as const

const unchangedUrls = [
  'https://proxy.example/v1?upstream=https://dashscope.aliyuncs.com',
  'https://dashscope.aliyuncs.com.proxy.example/v1',
  'https://dashscope.aliyuncs.com@proxy.example/v1',
  'https://sub.dashscope.aliyuncs.com/v1',
  'https://dashscope-us.aliyuncs.com/v1',
  'https://maas.qianwenaiapi.com/v1',
  'https://ap-southeast-1.maas.qwencloudapi.com/v1',
  'https://maas.qwencloudapi.com/v1',
  'https://dashscope.aliyuncs.com:65536/v1',
  'https://dashscope.aliyuncs.com:abc/v1',
  'https://dashscope.aliyuncs.com:-1/v1',
  'https://dashscope.aliyuncs.com:443:443/v1',
  'https://dashscope.aliyuncs.com\\@proxy.example/v1',
  'https://dashscope.aliyuncs.com\n/v1',
  ' https://dashscope.aliyuncs.com/v1',
  'https://dashscope.aliyuncs.com bad/v1',
  'ftp://dashscope.aliyuncs.com/v1',
  '//dashscope.aliyuncs.com/v1',
  'not a URL',
  ''
]

const cases: ReadonlyArray<readonly [string, string]> = [
  ...changedUrls,
  ...unchangedUrls.map((url) => [url, url] as const)
]

describe('Qwen official endpoint upgrade', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0034_qwen_endpoint_hosts' })

  it('migrates populated provider endpoints without changing credentials, models, or other JSON fields', () => {
    for (const [index, [baseUrl]] of cases.entries()) {
      dbh.db
        .insert(userProviderTable)
        .values({
          providerId: `provider-${index}`,
          presetProviderId: index % 2 === 0 ? 'dashscope' : null,
          name: `My provider ${index}`,
          orderKey: `a${index}`,
          endpointConfigs: {
            'openai-chat-completions': { baseUrl, dialect: { streamOptions: false } },
            'anthropic-messages': { baseUrl: 'https://dashscope-intl.aliyuncs.com/apps/anthropic' },
            'openai-responses': { baseUrl: 'https://my-proxy.example/v1' }
          },
          apiKeys: [{ id: 'saved-key', key: 'test-secret', isEnabled: true }],
          providerSettings: { extraHeaders: { 'X-Custom': 'keep' } },
          createdAt: 1000,
          updatedAt: 2000
        })
        .run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: `provider-${index}::my-model`,
          providerId: `provider-${index}`,
          modelId: 'my-model',
          name: 'My model',
          capabilities: [],
          supportsStreaming: true,
          orderKey: 'a0'
        })
        .run()
    }
    dbh.db.insert(userProviderTable).values({ providerId: 'empty', name: 'Empty', orderKey: 'z0' }).run()
    const before = dbh.db.select().from(userProviderTable).all()
    const modelsBefore = dbh.db.select().from(userModelTable).all()

    applyMigrations(dbh.db, resolveMigrationsPath())

    const after = dbh.db.select().from(userProviderTable).all()
    for (const original of before) {
      const row = after.find((entry) => entry.providerId === original.providerId)
      if (original.providerId === 'empty') {
        expect(row).toEqual(original)
        continue
      }
      const expectedUrl = cases[Number(original.providerId.slice('provider-'.length))][1]
      expect(row).toEqual({
        ...original,
        endpointConfigs: {
          ...original.endpointConfigs,
          'openai-chat-completions': { baseUrl: expectedUrl, dialect: { streamOptions: false } },
          'anthropic-messages': { baseUrl: 'https://maas.qwencloudapi.com/apps/anthropic' }
        }
      })
    }
    expect(dbh.db.select().from(userModelTable).all()).toEqual(modelsBefore)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')

    replayMigration(dbh, '0034_qwen_endpoint_hosts')
    expect(dbh.db.select().from(userProviderTable).all()).toEqual(after)
  })
})

describe('Qwen endpoint normalization during v1 import', () => {
  it.each(cases)('preserves the endpoint contract for %s', (input, expected) => {
    expect(migrateQwenEndpointUrl(input)).toBe(expected)
    expect(migrateQwenEndpointUrl(expected)).toBe(expected)
  })
})
