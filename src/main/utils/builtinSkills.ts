import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { parseSkillMetadata } from '@main/utils/markdownParser'
import { app } from 'electron'

import { SkillRepository } from '../services/agents/skills/SkillRepository'
import { skillService } from '../services/agents/skills/SkillService'
import { getDataPath, toAsarUnpackedPath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory and register them in the `skills` DB table.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Per-agent enablement is handled separately: each existing agent gets a
 * symlink at `{agentWorkspace}/.claude/skills/{folderName}/` via
 * `skillService.enableForAllAgents` for any **newly registered** builtin
 * (i.e. first-run or app-upgrade that adds a new builtin). Already-registered
 * builtins are left alone so user per-agent choices survive upgrades.
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the app
 * ships a newer version.
 */
// TODO: v2-backup
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'resources', 'skills'))
  const globalSkillsPath = getDataPath('Skills')
  const appVersion = app.getVersion()

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const destPath = path.join(globalSkillsPath, e.name)
    return destPath.startsWith(globalSkillsPath + path.sep)
  })

  let installed = 0
  // Process sequentially to avoid interleaved delete+insert on the skills
  // table when multiple builtins require a metadata refresh.
  for (const entry of dirs) {
    const destPath = path.join(globalSkillsPath, entry.name)
    const filesUpdated = !(await isUpToDate(destPath, appVersion))

    if (filesUpdated) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
      installed++
    }

    // Register (or refresh) the DB row; fan the skill out to existing agents
    // only when this is the first time we see it.
    await syncBuiltinSkillToDb(entry.name, destPath, filesUpdated)
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

/**
 * Ensure a built-in skill has a corresponding row in the `skills` DB table.
 * If the row already exists and files were not updated, skip.
 * If files were updated the metadata is refreshed. If the row is missing
 * entirely (first time we see this builtin) the skill is fanned out to every
 * existing agent's workspace.
 */
async function syncBuiltinSkillToDb(folderName: string, destPath: string, filesUpdated: boolean): Promise<void> {
  try {
    const repo = SkillRepository.getInstance()
    const existing = await repo.getByFolderName(folderName)

    if (existing && !filesUpdated) return

    const metadata = await parseSkillMetadata(destPath, folderName, 'skills')
    const contentHash = await computeHash(destPath)

    const tags = metadata.tags ? JSON.stringify(metadata.tags) : null

    if (existing) {
      // Update metadata in-place to preserve the skill ID and its agent_skills
      // rows (per-agent enablement state survives app upgrades).
      await repo.updateMetadata(existing.id, {
        name: metadata.name,
        description: metadata.description ?? null,
        author: metadata.author ?? null,
        tags,
        content_hash: contentHash
      })
    } else {
      const now = Date.now()
      const inserted = await repo.insert({
        name: metadata.name,
        description: metadata.description ?? null,
        folder_name: folderName,
        source: 'builtin',
        source_url: null,
        namespace: null,
        author: metadata.author ?? null,
        tags,
        content_hash: contentHash,
        is_enabled: false,
        created_at: now,
        updated_at: now
      })

      // Fan out to every agent on first install only.
      await skillService.enableForAllAgents(inserted.id, folderName)
    }

    logger.info('Built-in skill synced to DB', { folderName, firstInstall: !existing })
  } catch (error) {
    logger.warn('Failed to sync built-in skill to DB', {
      folderName,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function computeHash(skillDir: string): Promise<string> {
  const candidates = ['SKILL.md', 'skill.md']
  for (const name of candidates) {
    try {
      const content = await fs.readFile(path.join(skillDir, name), 'utf-8')
      return createHash('sha256').update(content).digest('hex')
    } catch {
      // try next
    }
  }
  return ''
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    const installedVersion = (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
    return installedVersion === appVersion
  } catch {
    return false
  }
}
