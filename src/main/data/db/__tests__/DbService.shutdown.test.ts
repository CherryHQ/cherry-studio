import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as DbServiceModule from '@data/db/DbService'
import { jobTable } from '@data/db/schemas/job'

const { DbService } = await vi.importActual<typeof DbServiceModule>('@data/db/DbService')

describe('DbService shutdown', () => {
  const dbh = setupTestDatabase()

  afterEach(() => vi.restoreAllMocks())

  it('releases its connection on destroy and preserves committed data for the next startup', async () => {
    dbh.db
      .insert(jobTable)
      .values({
        id: 'shutdown-job',
        type: 'shutdown.test',
        queue: 'shutdown.test',
        status: 'pending',
        scheduledAt: Date.now(),
        attempt: 0,
        maxAttempts: 1,
        input: {},
        cancelRequested: false,
        metadata: {}
      })
      .run()

    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'app.database.file' ? dbh.sqlite.name : getPath(key, filename)
    )
    const service = new DbService()
    const connection = service['sqlite']

    try {
      connection.pragma('journal_mode = WAL')
      await service._doStop()
      await service._doDestroy()

      expect(connection.open).toBe(false)

      const reopened = new Database(dbh.sqlite.name)
      try {
        expect(reopened.prepare('SELECT id FROM job').all()).toEqual([{ id: 'shutdown-job' }])
        expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok')
      } finally {
        reopened.close()
      }
    } finally {
      if (connection.open) connection.close()
    }
  })
})
