import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { DbService } from '../DbService'

vi.unmock('@main/data/db/DbService')
vi.mock('@main/core/diagnostics', () => ({
  DIAGNOSTICS_ENABLED: true,
  SLOW_THRESHOLD_MS: { dbQuery: 15 }
}))

// The probe must preserve SQLite's bound parameters, row results and native errors.
describe('DbService slow query probe', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
  })

  it('retains typed statement results and connection chaining', () => {
    vi.spyOn(application, 'getPath').mockReturnValue(dbh.sqlite.name)
    const service = new DbService()
    const sqlite = service['sqlite']
    try {
      const statement = sqlite.prepare<[number], { value: number }>('SELECT ? AS value')
      const first = statement.get(42)
      expectTypeOf(first).toEqualTypeOf<{ value: number } | undefined>()
      expect(first).toEqual({ value: 42 })
      expect(statement.all(7)).toEqual([{ value: 7 }])
      const named = sqlite.prepare<{ value: number }, { value: number }>('SELECT @value AS value')
      expect(named.get({ value: 9 })).toEqual({ value: 9 })
      expect(sqlite.prepare('SELECT 1 WHERE 0').get()).toBeUndefined()
      expect(sqlite.exec('PRAGMA foreign_keys = ON')).toBe(sqlite)

      const write = sqlite.prepare('UPDATE job SET priority = priority WHERE id = ?').run('missing-job')
      expect(write.changes).toBe(0)
      expect(sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    } finally {
      sqlite.close()
    }
  })

  it('propagates native statement and exec failures without swallowing them', () => {
    vi.spyOn(application, 'getPath').mockReturnValue(dbh.sqlite.name)
    const service = new DbService()
    const sqlite = service['sqlite']
    try {
      expect(() => sqlite.prepare('SELECT ?').get()).toThrow('Too few parameter values')
      expect(() => sqlite.exec('SELECT * FROM missing_probe_table')).toThrow('no such table')
      expect(sqlite.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    } finally {
      sqlite.close()
    }
  })
})
