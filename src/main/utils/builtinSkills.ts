import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'
import { app } from 'electron'

import { toAsarUnpackedPath } from './asar'

const logger = loggerService.withContext('builtinSkills')

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory and register them in the `skills` DB table.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Per-agent enablement needs no work here: `AgentGlobalSkillService.list()`
 * defaults a builtin skill to enabled for every agent until a user explicitly
 * disables it, so a synced `agent_global_skill` row is enabled everywhere
 * without any `agent_skill` rows.
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the app
 * ships a newer version.
 */
// TODO: v2-backup
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = toAsarUnpackedPath(application.getPath('feature.agents.skills.builtin'))
  const appVersion = app.getVersion()

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const sourcePath = path.join(resourceSkillsPath, e.name)
    return sourcePath.startsWith(resourceSkillsPath + path.sep)
  })

  let installed = 0
  // Process sequentially to avoid interleaved delete+insert on the skills
  // table when multiple builtins require a metadata refresh.
  for (const entry of dirs) {
    try {
      const filesUpdated = await skillService.syncBuiltinSkill(
        entry.name,
        path.join(resourceSkillsPath, entry.name),
        appVersion
      )
      if (filesUpdated) installed++
    } catch (error) {
      logger.warn('Failed to sync built-in skill to DB', {
        folderName: entry.name,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}
