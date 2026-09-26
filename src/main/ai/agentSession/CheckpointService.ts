import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { getBundledGitPath } from '@main/utils/bundledGit'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('CheckpointService')

// Never chase these into a copy or a git pathspec — they are either owned by
// git itself, regenerable, or Cherry's own scratch space for this feature.
const EXCLUDED_ENTRY_NAMES = new Set(['.git', 'node_modules', '.cherry'])

type GitCheckpoint = {
  mode: 'git'
  cwd: string
  /** Commit SHA of the stash entry holding the pre-turn tree, or null if the tree was already clean. */
  stashSha: string | null
  createdAt: number
}
type FileCheckpoint = {
  mode: 'files'
  cwd: string
  snapshotDir: string
  createdAt: number
}
type Checkpoint = GitCheckpoint | FileCheckpoint

/**
 * O1 — snapshots an agent session's workspace right before each autonomous turn,
 * so a one-click "undo everything" can restore it afterward. Git repos use a
 * scoped `git stash` (free, no extra disk); anything else falls back to a plain
 * directory copy under `feature.agents.checkpoints`.
 *
 * A failed checkpoint never blocks the turn — this is a safety net, not a gate.
 * Only one checkpoint is tracked per session: creating a new one forgets the
 * previous (its git stash entry, if any, is deliberately left in the stash list
 * rather than dropped by index — a stray stash costs nothing, a wrong drop can
 * destroy unrelated work).
 */
@Injectable('CheckpointService')
@ServicePhase(Phase.WhenReady)
export class CheckpointService extends BaseService {
  private readonly checkpoints = new Map<string, Checkpoint>()

  private gitBinary(): string {
    return getBundledGitPath() ?? 'git'
  }

  private async runGit(cwd: string, args: string[]): Promise<string> {
    // `-c core.autocrlf=false`: an "undo everything" promise means byte-exact
    // restoration. The user's own autocrlf setting (commonly on by default on
    // Windows) would otherwise rewrite line endings on checkout/stash apply,
    // silently changing file contents as part of "restoring" them.
    const { stdout } = await execFileAsync(this.gitBinary(), ['-c', 'core.autocrlf=false', ...args], { cwd })
    return stdout
  }

  private async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const stdout = await this.runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
      return stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  /** Snapshot `cwd` before an autonomous turn touches it. Safe to call every turn. */
  async createCheckpoint(sessionId: string, cwd: string): Promise<void> {
    try {
      const checkpoint = (await this.isGitRepo(cwd))
        ? await this.createGitCheckpoint(cwd)
        : await this.createFileCheckpoint(sessionId, cwd)
      this.checkpoints.set(sessionId, checkpoint)
      this.notifyStatus(sessionId, true)
    } catch (error) {
      logger.warn('Failed to create pre-turn checkpoint', { sessionId, cwd, error })
    }
  }

  private async createGitCheckpoint(cwd: string): Promise<GitCheckpoint> {
    const status = await this.runGit(cwd, ['status', '--porcelain', '--', '.'])
    if (status.trim() === '') {
      return { mode: 'git', cwd, stashSha: null, createdAt: Date.now() }
    }
    // Stash the pre-turn tree, capture it by SHA (stable even if the stash list
    // changes later), then re-apply immediately so the working tree is left
    // exactly as it was — the turn sees no side effect from taking this snapshot.
    await this.runGit(cwd, ['stash', 'push', '--include-untracked', '-m', 'cherry-checkpoint', '--', '.'])
    const stashSha = (await this.runGit(cwd, ['rev-parse', 'stash@{0}'])).trim()
    await this.runGit(cwd, ['stash', 'apply', stashSha])
    return { mode: 'git', cwd, stashSha, createdAt: Date.now() }
  }

  private async createFileCheckpoint(sessionId: string, cwd: string): Promise<FileCheckpoint> {
    const snapshotDir = path.join(application.getPath('feature.agents.checkpoints'), sessionId, String(Date.now()))
    await fs.mkdir(snapshotDir, { recursive: true })
    await copyWorkspace(cwd, snapshotDir)
    return { mode: 'files', cwd, snapshotDir, createdAt: Date.now() }
  }

  /** Whether a session currently has an undoable checkpoint. */
  status(sessionId: string): { available: boolean; createdAt?: number } {
    const checkpoint = this.checkpoints.get(sessionId)
    return checkpoint ? { available: true, createdAt: checkpoint.createdAt } : { available: false }
  }

  /** Restore the session's workspace to its pre-turn state. No-op (returns `restored: false`) if none exists. */
  async restore(sessionId: string): Promise<{ restored: boolean }> {
    const checkpoint = this.checkpoints.get(sessionId)
    if (!checkpoint) return { restored: false }

    if (checkpoint.mode === 'git') {
      // Bring tracked files back to HEAD, remove anything the turn created, then
      // reapply the pre-turn stash (if the tree wasn't already clean at checkpoint time).
      await this.runGit(checkpoint.cwd, ['checkout', 'HEAD', '--', '.'])
      // `git clean` respects .gitignore by default; a turn-created file that happens
      // to be gitignored survives this and stays behind — that is intentional: `-x`
      // would also sweep away pre-existing, unrelated gitignored build output.
      await this.runGit(checkpoint.cwd, ['clean', '-fd', '--', '.'])
      if (checkpoint.stashSha) {
        await this.runGit(checkpoint.cwd, ['stash', 'apply', checkpoint.stashSha])
      }
    } else {
      await restoreWorkspace(checkpoint.cwd, checkpoint.snapshotDir)
      await fs.rm(checkpoint.snapshotDir, { recursive: true, force: true }).catch(() => {})
    }

    this.checkpoints.delete(sessionId)
    this.notifyStatus(sessionId, false)
    return { restored: true }
  }

  private notifyStatus(sessionId: string, available: boolean): void {
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'agent_checkpoint.updated', {
      sessionId,
      available
    })
  }
}

async function copyWorkspace(source: string, dest: string): Promise<void> {
  await fs.cp(source, dest, {
    recursive: true,
    filter: (src) => !EXCLUDED_ENTRY_NAMES.has(path.basename(src))
  })
}

async function restoreWorkspace(cwd: string, snapshotDir: string): Promise<void> {
  const entries = await fs.readdir(cwd, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => !EXCLUDED_ENTRY_NAMES.has(entry.name))
      .map((entry) => fs.rm(path.join(cwd, entry.name), { recursive: true, force: true }))
  )
  await copyWorkspace(snapshotDir, cwd)
}
