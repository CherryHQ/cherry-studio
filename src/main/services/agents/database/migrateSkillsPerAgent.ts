/**
 * Data migration: seed the `agent_skills` join table from the legacy
 * `skills.is_enabled` global flag, and create per-agent workspace symlinks
 * so existing users keep their previously-enabled skills after upgrading
 * to the per-agent model.
 *
 * For every skill row where `is_enabled = true`, the skill is enabled for
 * every existing agent. Agents created after this migration runs go through
 * `SkillService.initSkillsForAgent`, which also seeds builtin skills.
 */

import * as path from 'node:path'

import { loggerService } from '@logger'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { app } from 'electron'

import type * as schema from './schema'
import { agentSkillsTable, agentsTable, skillsTable } from './schema'

const logger = loggerService.withContext('migrateSkillsPerAgent')

export async function runSkillsPerAgentMigration(db: LibSQLDatabase<typeof schema>): Promise<{
  agentsProcessed: number
  skillsSeeded: number
  symlinksCreated: number
}> {
  const enabledSkills = await db.select().from(skillsTable).where(eq(skillsTable.is_enabled, true))
  if (enabledSkills.length === 0) {
    logger.info('No legacy-enabled skills to migrate')
    return { agentsProcessed: 0, skillsSeeded: 0, symlinksCreated: 0 }
  }

  const agents = await db.select().from(agentsTable)
  if (agents.length === 0) {
    logger.info('No existing agents — skipping seed (new agents handled by initSkillsForAgent)')
    return { agentsProcessed: 0, skillsSeeded: 0, symlinksCreated: 0 }
  }

  // Load once here to avoid repeated require cycles, and to keep this migration
  // self-contained in case SkillService's internal structure changes later.
  const fs = await import('node:fs/promises')

  let skillsSeeded = 0
  let symlinksCreated = 0

  for (const agent of agents) {
    const workspace = parseFirstAccessiblePath(agent.accessible_paths)

    for (const skill of enabledSkills) {
      // Insert (or update) the join row as enabled.
      const now = Date.now()
      await db
        .insert(agentSkillsTable)
        .values({
          agent_id: agent.id,
          skill_id: skill.id,
          is_enabled: true,
          created_at: now,
          updated_at: now
        })
        .onConflictDoUpdate({
          target: [agentSkillsTable.agent_id, agentSkillsTable.skill_id],
          set: { is_enabled: true, updated_at: now }
        })
      skillsSeeded++

      if (!workspace) continue

      try {
        // Validate workspace exists on this machine (may be from a restored backup)
        const wsExists = await fs.stat(workspace).then(
          (s) => s.isDirectory(),
          () => false
        )
        if (!wsExists) continue

        const target = path.join(getSkillsStorageRoot(), skill.folder_name)
        const linkPath = path.join(workspace, '.claude', 'skills', skill.folder_name)
        await fs.mkdir(path.dirname(linkPath), { recursive: true })

        let existingIsCorrect = false
        try {
          const stat = await fs.lstat(linkPath)
          if (stat.isSymbolicLink()) {
            const existing = await fs.readlink(linkPath)
            if (existing === target) {
              existingIsCorrect = true
            } else {
              await fs.rm(linkPath, { recursive: true })
            }
          } else if (stat.isDirectory()) {
            // Real directory — may be a user-authored local skill. Skip to
            // avoid accidentally deleting user content (same policy as
            // SkillService.linkSkill).
            logger.warn('Migration: skipping non-symlink directory', { linkPath })
            continue
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }

        if (!existingIsCorrect) {
          await fs.symlink(target, linkPath, 'junction')
          symlinksCreated++
        }
      } catch (error) {
        logger.warn('Failed to create per-agent symlink during migration', {
          agentId: agent.id,
          skillId: skill.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  return { agentsProcessed: agents.length, skillsSeeded, symlinksCreated }
}

function parseFirstAccessiblePath(serialized: string | null | undefined): string | undefined {
  if (!serialized) return undefined
  try {
    const paths = JSON.parse(serialized) as unknown
    if (Array.isArray(paths) && paths.length > 0 && typeof paths[0] === 'string') {
      return paths[0]
    }
  } catch {
    // Fall through
  }
  return undefined
}

/**
 * Resolve the global skills storage root without pulling in the main-process
 * `getDataPath` helper (which hits Electron's `app` module during migration
 * startup, at a point where the `app.ready` event may not have fired yet).
 *
 * Mirrors `getDataPath('Skills')` — `userData/Data/Skills`.
 */
function getSkillsStorageRoot(): string {
  return path.join(app.getPath('userData'), 'Data', 'Skills')
}
