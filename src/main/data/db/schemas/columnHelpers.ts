import { integer } from 'drizzle-orm/sqlite-core'

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
