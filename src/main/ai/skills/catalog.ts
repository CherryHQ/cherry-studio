/**
 * Skill catalog orchestrator. Runs every source (DB + 6 filesystem
 * sources gated by opt-in flags), merges with priority + dedup, and
 * returns the ordered list. Pure orchestration — caching lives
 * inside each source so a refactor that swaps source backends
 * doesn't lose the cache.
 */

import { homedir } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'

import { mergeSkills } from './mergeSkills'
import { dbSource } from './sources/dbSource'
import { filesystemSource } from './sources/filesystemSource'
import { FILESYSTEM_SOURCES } from './sources/registry'
import type { Skill, SkillCtx } from './types'

const logger = loggerService.withContext('skillCatalog')

export async function listCatalog(ctx: SkillCtx): Promise<Skill[]> {
  const homeDir = ctx.homeDir ?? homedir()
  const prefs = application.get('PreferenceService')

  const fsLists = await Promise.all(
    FILESYSTEM_SOURCES.map(async (config) => {
      if (config.optInPreference && !prefs.get(config.optInPreference)) return []
      const rootDir = config.resolveRoot({ ...ctx, homeDir })
      if (!rootDir) return []
      try {
        return await filesystemSource({ rootDir, sourceId: config.sourceId })
      } catch (err) {
        logger.debug('filesystem source threw, skipping', { sourceId: config.sourceId, error: String(err) })
        return []
      }
    })
  )

  let dbList: Skill[] = []
  try {
    dbList = await dbSource()
  } catch (err) {
    logger.debug('db source threw, skipping', { error: String(err) })
  }

  // FILESYSTEM_SOURCES is ordered LOW→HIGH; merge expects the same
  // shape. DB sits at index 4 (between cherry-global and workspace-*),
  // matching the priority diagram in the Phase F design.
  const sourceLists: Skill[][] = []
  for (let i = 0; i < FILESYSTEM_SOURCES.length; i++) {
    sourceLists.push(fsLists[i])
    // Insert DB right after cherry-global, before workspace-*
    if (FILESYSTEM_SOURCES[i].sourceId === 'cherry-global') {
      sourceLists.push(dbList)
    }
  }

  return mergeSkills(sourceLists)
}
