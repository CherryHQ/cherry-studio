import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'

import { readPreferenceValueFromDatabaseFile } from '../readPreferenceValueFromDatabaseFile'

describe('readPreferenceValueFromDatabaseFile', () => {
  const dbh = setupTestDatabase()

  it('reads a stored preference value from the database file', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'app.developer_mode.enabled',
      value: true
    })

    const value = readPreferenceValueFromDatabaseFile(dbh.sqlite.name, 'app.developer_mode.enabled')
    expect(value === true || value === 'true').toBe(true)
  })

  it('returns undefined when the key is missing', () => {
    expect(readPreferenceValueFromDatabaseFile(dbh.sqlite.name, 'missing.key')).toBeUndefined()
  })
})
