import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { WorkspaceCopyError, fileErrorCode } from './WorkspaceCopyError'

export function containsWorkspacePath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export function buildWorkspaceCopyPaths(input: { storageRoot: string; sourceWorkspaceId: string; copyId: string }) {
  z.uuid().parse(input.sourceWorkspaceId)
  z.uuid().parse(input.copyId)
  if (!path.isAbsolute(input.storageRoot)) throw new WorkspaceCopyError('invalid_storage', 'admission')
  const parent = path.join(input.storageRoot, input.sourceWorkspaceId)
  const root = path.join(parent, input.copyId)
  return {
    parent,
    root,
    manifest: path.join(root, 'manifest.json'),
    index: path.join(root, 'copy-index.jsonl'),
    staging: path.join(root, 'project.partial'),
    project: path.join(root, 'project'),
    disposal: path.join(root, 'project.disposal')
  }
}

export type WorkspaceCopyPaths = ReturnType<typeof buildWorkspaceCopyPaths>

export async function canonicalWorkspacePath(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) throw new WorkspaceCopyError('invalid_storage', 'admission')
  try {
    return await realpath(candidate)
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') throw error
    // A dangling link must not be treated as a directory we are free to create.
    if (
      await lstat(candidate).catch((failure: unknown) => {
        if (fileErrorCode(failure) !== 'ENOENT') throw failure
        return undefined
      })
    )
      throw new WorkspaceCopyError('ownership_mismatch', 'admission')
    const parent = path.dirname(candidate)
    if (parent === candidate) throw error
    return path.join(await canonicalWorkspacePath(parent), path.basename(candidate))
  }
}

export async function outsideGitParent(source: string): Promise<string> {
  let result = path.dirname(source)
  for (let current = source; ; current = path.dirname(current)) {
    const git = await lstat(path.join(current, '.git')).catch((error: unknown) => {
      if (fileErrorCode(error) !== 'ENOENT') throw error
      return undefined
    })
    if (git) result = path.dirname(current)
    if (path.dirname(current) === current) return result
  }
}

export async function validateWorkspaceStorage(source: string, storageRoot: string): Promise<string> {
  const canonical = await canonicalWorkspacePath(storageRoot)
  if (canonical === path.parse(canonical).root || containsWorkspacePath(source, canonical)) {
    throw new WorkspaceCopyError('invalid_storage', 'admission')
  }
  for (let current = canonical; ; current = path.dirname(current)) {
    if (
      await lstat(path.join(current, '.git')).catch((error: unknown) => {
        if (fileErrorCode(error) !== 'ENOENT') throw error
        return undefined
      })
    )
      throw new WorkspaceCopyError('invalid_storage', 'admission')
    if (current === path.dirname(current)) return canonical
  }
}
