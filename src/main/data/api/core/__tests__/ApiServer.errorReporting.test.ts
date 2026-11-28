import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { describe, expect, it } from 'vitest'

import { tagTable } from '@main/data/db/schemas/tagging'
import { defaultHandlersFor, withSqliteErrors } from '@main/data/db/sqliteErrors'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { hasReportingOwner } from '@shared/utils/errorReporting'
import { getSentryLogContext } from '@shared/utils/sentry'

import { ApiServer } from '../ApiServer'

function createServer(handler: () => unknown): ApiServer {
  return new (ApiServer as any)({ '/tags': { POST: handler } })
}

describe('DataApi failure reporting boundary', () => {
  const dbh = setupTestDatabase()
  const request = { id: 'request', method: 'POST' as const, path: '/tags' }

  it.each([false, true])(
    'reports an untranslated constraint, but keeps a translated conflict local (translated=%s)',
    async (translated) => {
      dbh.db.insert(tagTable).values({ name: 'private tag' }).run()
      const insertDuplicate = () => dbh.db.insert(tagTable).values({ name: 'private tag' }).run()
      const server = createServer(() =>
        translated ? withSqliteErrors(insertDuplicate, defaultHandlersFor('Tag', 'private tag')) : insertDuplicate()
      )

      const response = await server.handleRequest(request)
      expect(response.status).toBe(translated ? 409 : 500)
      const reconstructed = DataApiError.fromJSON(response.error!)
      expect(hasReportingOwner(reconstructed)).toBe(true)
      const entry = mockMainLoggerService.error.mock.calls.at(-1)![1]
      const report = getSentryLogContext({ ...entry, level: 'error' })
      if (translated) expect(report).toBeUndefined()
      else {
        expect(report?.tags['failure.reason']).toBe('sqlite_constraint_unique')
        expect(report?.tags['failure.kind']).toBe('defect')
        expect(entry.errorMessage).not.toContain('private tag')
        expect(entry.stack).not.toMatch(/insert into|params:|private tag/)
      }
      expect(dbh.db.select().from(tagTable).all()).toHaveLength(1)
    }
  )

  it('reports inconsistent data even though its HTTP status is 409', async () => {
    const server = createServer(() => {
      throw new DataApiError(ErrorCode.DATA_INCONSISTENT, 'private data', 409)
    })
    const response = await server.handleRequest(request)
    expect(response.status).toBe(409)
    const entry = mockMainLoggerService.error.mock.calls.at(-1)![1]
    expect(getSentryLogContext(entry)?.tags['failure.kind']).toBe('reliability')
    expect(response.error?.reportingHandled).toBe(true)
  })

  it('keeps middleware validation local and propagates its ownership to the client', async () => {
    const server = createServer(() => {
      throw new Error('handler must not run')
    })
    server.use({
      name: 'validate',
      priority: 5,
      execute: () => {
        throw DataApiErrorFactory.validation({ name: ['Required'] })
      }
    })
    const response = await server.handleRequest(request)
    expect(response.status).toBe(422)
    expect(response.error?.reportingHandled).toBe(true)
    const entry = mockMainLoggerService.error.mock.calls.at(-1)![1]
    expect(getSentryLogContext(entry)).toBeUndefined()
  })

  it('reports missing handlers instead of treating them as a missing user resource', async () => {
    const response = await createServer(() => undefined).handleRequest({ ...request, path: '/missing' })
    expect(response.status).toBe(404)
    const entry = mockMainLoggerService.error.mock.calls.at(-1)![1]
    expect(getSentryLogContext(entry)?.tags['failure.reason']).toBe('data_handler_missing')
  })
})
