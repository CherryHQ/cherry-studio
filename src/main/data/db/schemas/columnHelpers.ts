import { integer, text } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

/**
 * UUID v4 primary key with auto-generation
 * Use for general purpose tables
 */
export const uuidPrimaryKey = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv4())

/**
 * UUID v7 primary key with auto-generation (time-ordered)
 * Use for tables with large datasets that benefit from sequential inserts
 */
export const uuidPrimaryKeyOrdered = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv7())

const createTimestamp = () => {
  return Date.now()
}

export const createUpdateTimestamps = {
  createdAt: integer().$defaultFn(createTimestamp),
  updatedAt: integer().$defaultFn(createTimestamp).$onUpdateFn(createTimestamp)
}

export const createUpdateDeleteTimestamps = {
  createdAt: integer().$defaultFn(createTimestamp),
  updatedAt: integer().$defaultFn(createTimestamp).$onUpdateFn(createTimestamp),
  deletedAt: integer()
}
