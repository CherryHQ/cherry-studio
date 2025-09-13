/**
 * Drizzle Kit configuration for agents database
 */

import { defineConfig } from 'drizzle-kit'
import { app } from 'electron'
import path from 'path'

// Get the database path (same as BaseService)
const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'agents.db')

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/services/agents/database/schema/index.ts',
  out: './src/main/services/agents/database/drizzle',
  dbCredentials: {
    url: `file:${dbPath}`
  },
  verbose: true,
  strict: true
})
