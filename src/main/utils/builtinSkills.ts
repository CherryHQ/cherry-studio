import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'

/**
 * Copy built-in skills from app resources to the user-level .claude/skills
 * directory so they are available to all Claude Code agent sessions via
 * CLAUDE_CONFIG_DIR.
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill is overwritten only when the app ships a
 * newer version.
 */
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = path.join(app.getAppPath(), 'resources', 'skills')
  const destSkillsPath = path.join(app.getPath('userData'), '.claude', 'skills')
  const appVersion = app.getVersion()

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  let installed = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    // Guard against path traversal (e.g. entry.name containing "..")
    const destPath = path.join(destSkillsPath, entry.name)
    if (!destPath.startsWith(destSkillsPath + path.sep)) continue

    if (await isUpToDate(destPath, appVersion)) continue

    await fs.mkdir(destPath, { recursive: true })
    await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
    await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
    installed++
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    const installedVersion = (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
    return installedVersion === appVersion
  } catch {
    return false
  }
}
