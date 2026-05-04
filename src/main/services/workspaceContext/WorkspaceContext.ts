/**
 * Workspace context — a small per-root snapshot used by anything that
 * needs to know "what does this directory look like right now". The
 * system prompt's `env` section is the first consumer; future ones
 * include the `apply_patch` tool's "verify with git diff" hint and
 * git-worktree session creation.
 *
 * Cached via `CacheService` (same backing store as `finderPool`). 30s
 * TTL keeps git state reasonably fresh without spawning `git` on every
 * prompt build.
 */

import { application } from '@application'

import { detectGitState, type GitState } from './gitDetector'

export interface WorkspaceInfo {
  /** Absolute path; `null` when the topic isn't bound to a workspace. */
  workspaceRoot: string | null
  /** `true` if `workspaceRoot` is inside a git repository. */
  isGitRepo: boolean
  /** Present only when `isGitRepo` is true. */
  git?: GitState
}

const CACHE_TTL_MS = 30_000
const KEY_PREFIX = 'workspaceContext.info.'

const EMPTY: WorkspaceInfo = { workspaceRoot: null, isGitRepo: false }

export async function getWorkspaceInfo(workspaceRoot: string | null | undefined): Promise<WorkspaceInfo> {
  if (!workspaceRoot) return EMPTY

  const cache = application.get('CacheService')
  const key = `${KEY_PREFIX}${workspaceRoot}`

  const cached = cache.get<WorkspaceInfo>(key)
  if (cached) return cached

  const git = await detectGitState(workspaceRoot)
  const info: WorkspaceInfo = git ? { workspaceRoot, isGitRepo: true, git } : { workspaceRoot, isGitRepo: false }

  cache.set(key, info, CACHE_TTL_MS)
  return info
}
