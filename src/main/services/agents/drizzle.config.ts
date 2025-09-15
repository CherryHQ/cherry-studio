/**
 * Drizzle Kit configuration for agents database
 */

import os from 'node:os'
import path from 'node:path'

import { defineConfig } from 'drizzle-kit'

export const dbPath = path.join(os.homedir(), '.cherrystudio', 'data', 'agents.db')

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
