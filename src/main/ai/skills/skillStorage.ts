import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { InstalledSkill, SkillStorageInfo } from '@shared/types/skill'

/** Inspect links without losing their identity when the source is temporarily absent. */
export async function inspectSkillStorage(
  directory: string,
  skill: Pick<InstalledSkill, 'source' | 'sourceUrl'>
): Promise<SkillStorageInfo> {
  let sourcePath: string | null = null
  if (skill.source === 'system' && skill.sourceUrl?.startsWith('file:')) {
    try {
      sourcePath = fileURLToPath(skill.sourceUrl)
    } catch {
      return { mode: null, sourcePath: null, status: 'invalid' }
    }
  }
  let mode: SkillStorageInfo['mode'] = null
  try {
    const entry = await fs.lstat(directory)
    mode = entry.isSymbolicLink() ? 'symlink' : 'copy'
    if (entry.isSymbolicLink()) {
      const target = path.resolve(path.dirname(directory), await fs.readlink(directory))
      if (!sourcePath || target !== path.resolve(sourcePath)) return { mode, sourcePath, status: 'invalid' }
      const resolved = await fs.realpath(directory)
      if (resolved !== sourcePath) return { mode, sourcePath, status: 'invalid' }
      if (!(await fs.stat(directory)).isDirectory()) return { mode, sourcePath, status: 'invalid' }
    } else if (!entry.isDirectory()) {
      return { mode, sourcePath, status: 'invalid' }
    }
    await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')
    return { mode, sourcePath, status: 'ready' }
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    return { mode, sourcePath, status: missing ? 'missing' : 'unreadable' }
  }
}
