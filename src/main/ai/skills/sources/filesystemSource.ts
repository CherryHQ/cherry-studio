import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import { parseSkill } from '../parseSkill'
import type { Skill, SourceId } from '../types'

const logger = loggerService.withContext('filesystemSkillSource')

const CACHE_TTL_MS = 30 * 60 * 1000
const KEY_PREFIX = 'skills.parsed.'

interface CacheEntry {
  mtimeMs: number
  skill: Skill
}

interface Args {
  rootDir: string
  sourceId: SourceId
}

export async function filesystemSource(args: Args): Promise<Skill[]> {
  let entries: string[]
  try {
    const dirents = await readdir(args.rootDir, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name)
  } catch {
    return []
  }

  const skills: Skill[] = []
  for (const folderName of entries) {
    const skillFilePath = join(args.rootDir, folderName, 'SKILL.md')
    let canonicalPath: string
    try {
      canonicalPath = await realpath(skillFilePath)
    } catch {
      continue
    }
    const skill = await loadOne(canonicalPath, args.sourceId)
    if (skill) skills.push(skill)
  }
  return skills
}

async function loadOne(canonicalPath: string, sourceId: SourceId): Promise<Skill | null> {
  let mtimeMs: number
  try {
    const s = await stat(canonicalPath)
    mtimeMs = s.mtimeMs
  } catch {
    return null
  }

  const cache = application.get('CacheService')
  const key = `${KEY_PREFIX}${canonicalPath}`
  const cached = cache.get<CacheEntry>(key)
  if (cached && cached.mtimeMs === mtimeMs) return cached.skill

  let raw: string
  try {
    raw = await readFile(canonicalPath, 'utf8')
  } catch (err) {
    logger.debug('failed to read SKILL.md', { canonicalPath, error: String(err) })
    return null
  }

  const parsed = parseSkill({ raw, path: canonicalPath, source: sourceId })
  if (parsed) cache.set(key, { mtimeMs, skill: parsed }, CACHE_TTL_MS)
  return parsed
}
