import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { archiveHandlers } from '@data/api/handlers/archives'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import { listArchives } from '@data/services/archive'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const dbh = setupTestDatabase()

function seedArchive() {
  dbh.db
    .insert(assistantTable)
    .values({
      id: 'same',
      name: 'Assistant',
      emoji: '',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a0',
      deletedAt: 200
    })
    .run()
  dbh.db
    .insert(topicTable)
    .values([
      { id: 'same', name: 'Topic', orderKey: 'a0', deletedAt: 600 },
      { id: 'active', name: 'Active topic', orderKey: 'a1' }
    ])
    .run()
  dbh.db
    .insert(agentTable)
    .values({ id: 'same', name: 'Agent', type: 'claude-code', instructions: '', orderKey: 'a0', deletedAt: 400 })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/archive-test', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'same', name: 'Session', workspaceId: 'workspace', orderKey: 'a0', deletedAt: 500 })
    .run()
  dbh.db
    .insert(paintingTable)
    .values({ id: 'same', prompt: 'Painting', providerId: 'test', orderKey: 'a0', deletedAt: 300 })
    .run()
  dbh.db
    .insert(fileEntryTable)
    .values([
      { id: 'same', name: 'File', ext: 'txt', origin: 'internal', size: 1, deletedAt: 100 },
      { id: 'external', name: 'External', origin: 'external', externalPath: '/archive-test/external' }
    ])
    .run()
}

describe('archive list', () => {
  it('pages across all six domains without including active content or background sessions', () => {
    seedArchive()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'heartbeat',
        type: 'background',
        name: 'Heartbeat',
        workspaceId: 'workspace',
        orderKey: 'a1',
        deletedAt: 550
      })
      .run()
    const first = listArchives({ limit: 2 })
    const second = listArchives({ limit: 2, cursor: first.nextCursor })
    const third = listArchives({ limit: 2, cursor: second.nextCursor })
    expect([...first.items, ...second.items, ...third.items].map(({ id, name }) => [id, name])).toEqual([
      ['topics:same', 'Topic'],
      ['sessions:same', 'Session'],
      ['agents:same', 'Agent'],
      ['paintings:same', 'Painting'],
      ['assistants:same', 'Assistant'],
      ['files:same', 'File.txt']
    ])
    expect(third.nextCursor).toBeUndefined()
  })

  it('does not skip same-time entries when the cursor row is restored between pages', () => {
    seedArchive()
    dbh.db.update(topicTable).set({ deletedAt: 400 }).where(eq(topicTable.id, 'same')).run()
    dbh.db.update(agentSessionTable).set({ deletedAt: 400 }).run()
    const first = listArchives({ limit: 1 })
    expect(first.items[0].id).toBe('agents:same')
    dbh.db.update(agentTable).set({ deletedAt: null }).run()
    const second = listArchives({ limit: 2, cursor: first.nextCursor })
    expect(second.items.map(({ id }) => id)).toEqual(['sessions:same', 'topics:same'])
  })

  it('rejects invalid page limits before querying', async () => {
    await expect(archiveHandlers['/archives'].GET({ query: { limit: 0 } })).rejects.toThrow()
    await expect(archiveHandlers['/archives'].GET({ query: { limit: 201 } })).rejects.toThrow()
  })
})
