/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
/**
 * Drizzle Kit configuration for agents database
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DATA_PATH } from '@main/config'
import { isDev } from '@main/constant'
import { makeSureDirExists } from '@main/utils'
import { defineConfig } from 'drizzle-kit'
import { app } from 'electron'

function getDbPath() {
  const oldAgentsDbPath = isDev
    ? path.join(os.homedir(), '.cherrystudio', 'data', 'agents.db')
    : path.join(app.getPath('userData'), 'agents.db')

  const agentsDbPath = path.join(DATA_PATH, 'Agents', 'agents.db')

  makeSureDirExists(path.dirname(agentsDbPath))

  if (fs.existsSync(oldAgentsDbPath)) {
    fs.renameSync(oldAgentsDbPath, agentsDbPath)
  }

  return agentsDbPath
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
