import path from 'node:path'

import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as SdkConfig from '@main/ai/provider/sdkConfig'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import type { CompactionAnchorData } from '@shared/ai/compaction'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { buildAgentParams } from '../buildAgentParams'

vi.mock('@main/ai/provider/sdkConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkConfig>()),
  resolveSdkConfig: async () => ({
    sdkConfig: { providerId: 'openai-compatible', providerSettings: {} },
    credentialReceipt: { attribution: 'unknown' }
  })
}))

vi.mock('@main/ai/contextBuild/resolveRequestContextSettings', () => ({
  resolveRequestContextSettings: async () => ({
    contextSettings: DEFAULT_CONTEXT_SETTINGS,
    compressionModel: null
  })
}))

describe('buildAgentParams compaction applicability', () => {
  const dbh = setupTestDatabase()

  beforeAll(() => {
    vi.spyOn(application, 'getPath').mockImplementation((_key, filename) =>
      path.join(process.cwd(), 'packages/provider-registry/data', filename ?? '')
    )
  })
  afterAll(() => vi.restoreAllMocks())

  it.each([
    { messageId: 'assistant-1', contextOwner: undefined, expectedWarnings: 1 },
    { messageId: undefined, contextOwner: undefined, expectedWarnings: 0 },
    { messageId: 'synthetic-message', contextOwner: undefined, expectedWarnings: 0 },
    { messageId: 'assistant-1', contextOwner: 'caller' as const, expectedWarnings: 0 }
  ])('reports an unavailable compressor only for a persisted Cherry-managed turn: %j', async (testCase) => {
    dbh.db.insert(topicTable).values({ id: 'topic-1', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-1', [
          {
            id: 'assistant-1',
            topicId: 'topic-1',
            role: 'assistant',
            status: 'pending',
            data: { parts: [] }
          }
        ])
      )
      .run()
    const warnings: CompactionAnchorData[] = []

    await buildAgentParams({
      request: {
        conversation: { id: 'topic-1', topicId: 'topic-1' },
        messageId: testCase.messageId,
        contextOwner: testCase.contextOwner
      },
      signal: undefined,
      provider: makeProvider(),
      model: makeModel({ contextWindow: 100_000 }),
      compactionSink: (_id, data) => warnings.push(data)
    })

    expect(warnings).toEqual(testCase.expectedWarnings ? [{ status: 'failed', phase: 'turn-start' }] : [])
  })
})
