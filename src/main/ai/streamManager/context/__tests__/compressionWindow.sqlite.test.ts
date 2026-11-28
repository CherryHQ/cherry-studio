import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AiCore from '@cherrystudio/ai-core'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'

const { summarize, resolveSettings } = vi.hoisted(() => ({ summarize: vi.fn(), resolveSettings: vi.fn() }))

vi.mock('@cherrystudio/ai-core', async (original) => ({
  ...(await original<typeof AiCore>()),
  summarizeModelMessages: summarize
}))
vi.mock('../../../contextBuild/resolveRequestContextSettings', () => ({
  resolveRequestContextSettings: resolveSettings
}))

import { PersistentChatContextProvider } from '../PersistentChatContextProvider'

const model = { contextWindow: 16000 } as Model

describe('compression window with production SQLite history', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    summarize.mockResolvedValue('MIDDLE_SUMMARY')
    resolveSettings.mockResolvedValue({
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, maxMessages: 1, compressWindow: 2 },
      compressionModel: { languageModel: {}, contextWindow: 16000 }
    })
    const chain = [
      ['u0', 'user'],
      ['a0', 'assistant'],
      ['u1', 'user'],
      ['a1', 'assistant'],
      ['u2', 'user']
    ] as const
    dbh.db.insert(topicTable).values({ id: 'topic-window', activeNodeId: 'u2', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot(
          'topic-window',
          chain.map(([id, role], index) => ({
            id,
            topicId: 'topic-window',
            parentId: index ? chain[index - 1][0] : null,
            role,
            data: { parts: [{ type: 'text' as const, text: id + '_ORIGINAL' }] },
            status: 'success' as const,
            siblingsGroupId: 0,
            createdAt: index,
            updatedAt: index,
            compactionSummary: id === 'a1' ? 'OLD_SUMMARY_WITH_EXCLUDED_CONTENT' : null
          }))
        )
      )
      .run()
  })

  it.each(['success', 'failure'])('does not rewrite any source row on %s', async (outcome) => {
    if (outcome === 'failure') summarize.mockRejectedValueOnce(new Error('offline'))
    const before = dbh.db.select().from(messageTable).all()
    const result = await new PersistentChatContextProvider()['resolveCompactedHistory'](
      'u2',
      'topic-window',
      [model],
      undefined
    )
    expect(dbh.db.select().from(messageTable).all()).toEqual(before)
    expect(messageService.getById('a1').compactionSummary).toBe('OLD_SUMMARY_WITH_EXCLUDED_CONTENT')
    expect(result.messages.map((message) => message.id)).toEqual(
      outcome === 'success' ? ['compaction:a1', 'u2'] : ['u2']
    )
    expect(JSON.stringify(result.messages)).not.toMatch(/u0_ORIGINAL|OLD_SUMMARY_WITH_EXCLUDED_CONTENT/)
    if (outcome === 'success') expect(JSON.stringify(result.messages)).toContain('MIDDLE_SUMMARY')
  })
})
