/**
 * Drizzle Kit configuration for agents database
 */

import os from 'node:os'
import path from 'node:path'

import { defineConfig } from 'drizzle-kit'
import { app } from 'electron'

function getDbPath() {
  if (process.env.NODE_ENV === 'development') {
    return path.join(os.homedir(), '.cherrystudio', 'data', 'agents.db')
  }
  return path.join(app.getPath('userData'), 'agents.db')
}

const resolvedDbPath = getDbPath()

export const dbPath = resolvedDbPath

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/services/agents/database/schema/index.ts',
  out: './resources/database/drizzle',
  dbCredentials: {
    url: `file:${resolvedDbPath}`
  },
  verbose: true,
  strict: true
})
