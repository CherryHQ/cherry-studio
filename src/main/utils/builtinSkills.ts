import fs from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { skillService } from '@main/ai/skills/SkillService'

import { toAsarUnpackedPath } from './asar'

const logger = loggerService.withContext('builtinSkills')

/** Owns the skills the Prometheus pack ships, so a name clash with a Cherry builtin is refused. */
const PROMETHEUS_NAMESPACE = 'prometheus'

/**
 * The skill folder names the Prometheus submodule ships.
 *
 * Read from the submodule rather than a hardcoded list so adding or removing a skill
 * upstream needs no change here. An unreadable submodule yields an empty set, which means
 * every skill installs under the default namespace exactly as before this existed —
 * degraded, never blocking a launch.
 */
async function listPrometheusSkillNames(): Promise<Set<string>> {
  const packSkills = toAsarUnpackedPath(
    path.join(application.getPath('app.root.resources'), 'prometheus-skills-mini', 'skills')
  )
  try {
    const entries = await fs.readdir(packSkills, { withFileTypes: true })
    return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  } catch {
    return new Set()
  }
}

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

  // Which of these came from the Prometheus pack. Both sets live in `resources/skills/`
  // — `scripts/sync-prometheus-skills.ts` copies the pack's into the same directory — so
  // the submodule is what distinguishes them. Namespacing makes a folder-name clash a
  // refusal by the ownership guard in `syncBuiltinSkill` rather than a silent overwrite;
  // there is no clash today, but the two sets are maintained in different repositories.
  const prometheusSkills = await listPrometheusSkillNames()

  let installed = 0
  // Process sequentially to avoid interleaved delete+insert on the skills
  // table when multiple builtins require a metadata refresh.
  for (const entry of dirs) {
    try {
      const filesUpdated = await skillService.syncBuiltinSkill(
        entry.name,
        path.join(resourceSkillsPath, entry.name),
        appVersion,
        prometheusSkills.has(entry.name) ? PROMETHEUS_NAMESPACE : null
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
