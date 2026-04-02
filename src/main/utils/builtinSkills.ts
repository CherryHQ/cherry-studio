import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { parseSkillMetadata } from '@main/utils/markdownParser'
import { app } from 'electron'

import { SkillRepository } from '../services/agents/skills/SkillRepository'
import { getDataPath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'

/**
 * Copy built-in skills from app resources to the global-skills storage
 * directory, then create symlinks in .claude/skills/ so they are
 * discoverable by Claude Code.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 * Symlink:  {userData}/.claude/skills/{folderName}/ → storage
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill is overwritten only when the app ships a
 * newer version.
 *
 * Built-in skills are also registered in the `skills` DB table so they appear
 * in the SkillsSettings UI alongside user-installed skills.
 */
// TODO: v2-backup
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = path.join(app.getAppPath(), 'resources', 'skills')
  const globalSkillsPath = getDataPath('Skills')
  const linkBasePath = path.join(app.getPath('userData'), '.claude', 'skills')
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
    const destPath = path.join(globalSkillsPath, entry.name)
    if (!destPath.startsWith(globalSkillsPath + path.sep)) continue

    const filesUpdated = !(await isUpToDate(destPath, appVersion))

    if (filesUpdated) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
      installed++
    }

    // Ensure symlink exists: .claude/skills/{name} → global-skills/{name}
    await ensureSymlink(destPath, path.join(linkBasePath, entry.name))

    // Ensure the skill is registered in the DB
    await syncBuiltinSkillToDb(entry.name, destPath, filesUpdated)
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

/**
 * Create a symlink if it doesn't already exist or points to the wrong target.
 */
async function ensureSymlink(target: string, linkPath: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(linkPath), { recursive: true })

    // Check existing link
    try {
      const existing = await fs.readlink(linkPath)
      if (existing === target) return // already correct
      // Wrong target — remove and recreate
      await fs.rm(linkPath, { recursive: true })
    } catch {
      // Doesn't exist or not a symlink — remove if something else is there
      try {
        await fs.rm(linkPath, { recursive: true })
      } catch {
        // nothing there
      }
    }

    await fs.symlink(target, linkPath, 'junction')
  } catch (error) {
    logger.warn('Failed to create symlink for built-in skill', {
      target,
      linkPath,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Ensure a built-in skill has a corresponding row in the `skills` DB table.
 * If the row already exists and files were not updated, skip.
 * If files were updated or the row is missing, upsert.
 */
async function syncBuiltinSkillToDb(folderName: string, destPath: string, filesUpdated: boolean): Promise<void> {
  try {
    const repo = SkillRepository.getInstance()
    const existing = await repo.getByFolderName(folderName)

    if (existing && !filesUpdated) return

    const metadata = await parseSkillMetadata(destPath, folderName, 'skills')
    const contentHash = await computeHash(destPath)

    if (existing) {
      // Delete and re-insert to update metadata
      await repo.delete(existing.id)
    }

    const now = Date.now()
    await repo.insert({
      name: metadata.name,
      description: metadata.description ?? null,
      folder_name: folderName,
      source: 'builtin',
      source_url: null,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ? JSON.stringify(metadata.tags) : null,
      content_hash: contentHash,
      is_enabled: existing?.isEnabled ?? true,
      created_at: existing ? existing.createdAt : now,
      updated_at: now
    })

    logger.info('Built-in skill synced to DB', { folderName })
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
