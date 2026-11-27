import { lstatSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function resolveWorkspace(candidate: string): string {
  try {
    return realpathSync(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const entry = lstatSync(candidate, { throwIfNoEntry: false })
    if (entry) throw new Error('Workspace alias cannot be resolved; retaining fork files')
    const parent = path.dirname(candidate)
    if (parent === candidate) throw error
    return path.join(resolveWorkspace(parent), path.basename(candidate))
  }
}

function ancestry(candidate: string): Set<string> {
  const identities = new Set<string>()
  for (let current = candidate; ; current = path.dirname(current)) {
    const info = statSync(current, { bigint: true, throwIfNoEntry: false })
    if (info) {
      if (!info.isDirectory() || info.ino === 0n) throw new Error('Workspace identity cannot be verified')
      identities.add(`${info.dev}:${info.ino}`)
    }
    if (current === path.dirname(current)) return identities
  }
}

/** The caller must detach in the same synchronous turn. Unverifiable paths throw, never authorize deletion. */
export function workspaceHasReferences(directory: string, workspaces: readonly string[]): boolean {
  const root = realpathSync(directory)
  const rootInfo = statSync(root, { bigint: true })
  if (!rootInfo.isDirectory() || rootInfo.ino === 0n) throw new Error('Fork workspace identity cannot be verified')
  const rootIdentity = `${rootInfo.dev}:${rootInfo.ino}`
  const rootParents = ancestry(root)
  for (const workspace of workspaces) {
    const candidate = resolveWorkspace(workspace)
    if (contains(root, candidate) || contains(candidate, root)) return true
    const candidateParents = ancestry(candidate)
    if (candidateParents.has(rootIdentity)) return true
    const info = statSync(candidate, { bigint: true, throwIfNoEntry: false })
    if (info && rootParents.has(`${info.dev}:${info.ino}`)) return true
  }
  return false
}
