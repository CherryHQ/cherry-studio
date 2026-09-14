import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function resolveWorkspace(candidate: string): Promise<string> {
  try {
    return await realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const entry = await lstat(candidate).catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== 'ENOENT') throw failure
      return undefined
    })
    if (entry) throw new Error('Workspace alias cannot be resolved; retaining fork files')
    const parent = path.dirname(candidate)
    if (parent === candidate) throw error
    return path.join(await resolveWorkspace(parent), path.basename(candidate))
  }
}

async function ancestry(candidate: string): Promise<Set<string>> {
  const identities = new Set<string>()
  for (let current = candidate; ; current = path.dirname(current)) {
    const info = await stat(current, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (info) {
      if (!info.isDirectory() || info.ino === 0n) throw new Error('Workspace identity cannot be verified')
      identities.add(`${info.dev}:${info.ino}`)
    }
    if (current === path.dirname(current)) return identities
  }
}

/** Called only under a persistent registration claim. Unverifiable paths throw, never authorize deletion. */
export async function workspaceHasReferences(directory: string, workspaces: readonly string[]): Promise<boolean> {
  const root = await realpath(directory)
  const rootInfo = await stat(root, { bigint: true })
  if (!rootInfo.isDirectory() || rootInfo.ino === 0n) throw new Error('Fork workspace identity cannot be verified')
  const rootIdentity = `${rootInfo.dev}:${rootInfo.ino}`
  const rootParents = await ancestry(root)
  for (const workspace of workspaces) {
    const candidate = await resolveWorkspace(workspace)
    if (contains(root, candidate) || contains(candidate, root)) return true
    const candidateParents = await ancestry(candidate)
    if (candidateParents.has(rootIdentity)) return true
    const info = await stat(candidate, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (info && rootParents.has(`${info.dev}:${info.ino}`)) return true
  }
  return false
}
