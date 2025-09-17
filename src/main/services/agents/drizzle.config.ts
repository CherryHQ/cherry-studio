/**
 * Drizzle Kit configuration for agents database
 */

import os from 'node:os'
import path from 'node:path'

import { isDev } from '@main/constant'
import { defineConfig } from 'drizzle-kit'
import { app } from 'electron'

function getDbPath() {
  if (isDev) {
    return path.join(os.homedir(), '.cherrystudio', 'data', 'agents.db')
  }
  return path.join(app.getPath('userData'), 'agents.db')
}

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/services/agents/database/schema/index.ts',
  out: './src/main/services/agents/database/drizzle',
  dbCredentials: {
    url: `file:${getDbPath()}`
  },
  verbose: true,
  strict: true
})
