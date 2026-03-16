import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('builtinSkills')

/**
 * Copy built-in skills from app resources to the user-level .claude/skills
 * directory so they are available to all Claude Code agent sessions via
 * CLAUDE_CONFIG_DIR. Skips skills that already exist to preserve user modifications.
 */
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = path.join(app.getAppPath(), 'resources', 'skills')
  const destSkillsPath = path.join(app.getPath('userData'), '.claude', 'skills')

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
    try {
      await fs.access(destPath)
      continue
    } catch {
      // Destination doesn't exist, proceed with copy
    }

    await fs.mkdir(destPath, { recursive: true })
    await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
    installed++
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, destSkillsPath })
  }
}
