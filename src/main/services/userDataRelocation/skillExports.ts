import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { isWin } from '@main/core/platform'

import { isErrno, normalizeForCompare } from './validation'

/** Retarget only links to the corresponding Cherry-owned skill, returning a rollback operation. */
export async function retargetSkillExports(from: string, to: string): Promise<() => Promise<void>> {
  const exportsRoot = application.getPath('external.agents.skills')
  const entries = await fsp.readdir(exportsRoot, { withFileTypes: true }).catch((error) => {
    if (isErrno(error, 'ENOENT')) return []
    throw error
  })
  const changed: Array<{ entry: string; previous: string; next: string }> = []
  const restore = async () => {
    const errors: unknown[] = []
    for (const change of changed.toReversed()) {
      await replaceExport(change.entry, change.next, change.previous).catch((error) => errors.push(error))
    }
    if (errors.length) throw new AggregateError(errors, 'Failed to restore relocated skill exports')
  }
  if (!entries.length) return restore

  const relative = path.relative(
    application.getPath('app.userdata'),
    application.getPath('feature.agents.claude.skills')
  )
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Claude skill discovery must be inside userData during relocation')
  }
  try {
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue
      const exported = path.join(exportsRoot, entry.name)
      const previous = path.resolve(from, relative, entry.name)
      const target = path.resolve(exportsRoot, await fsp.readlink(exported))
      if (normalizeForCompare(target) !== normalizeForCompare(previous)) continue
      const next = path.resolve(to, relative, entry.name)
      changed.push({ entry: exported, previous, next })
      await replaceExport(exported, previous, next)
    }
  } catch (error) {
    try {
      await restore()
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], 'Failed to retarget and restore skill exports')
    }
    throw error
  }
  return restore
}

async function replaceExport(entry: string, expected: string, replacement: string): Promise<void> {
  const target = await fsp.readlink(entry).catch((error) => {
    if (isErrno(error, 'ENOENT')) return null
    throw error
  })
  if (target !== null) {
    if (normalizeForCompare(path.resolve(path.dirname(entry), target)) === normalizeForCompare(replacement)) return
    if (normalizeForCompare(path.resolve(path.dirname(entry), target)) !== normalizeForCompare(expected)) {
      throw new Error(`Skill export changed during relocation: ${entry}`)
    }
    await fsp.unlink(entry)
  }
  await fsp.symlink(replacement, entry, isWin ? 'junction' : 'dir')
}
