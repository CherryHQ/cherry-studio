import { promises as fs } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import type { AgentSessionLiveIndex } from '../types'

const logger = loggerService.withContext('ClaudeCodeSessionFileSweep')

/**
 * Never touch anything written recently: in-flight first turns and prewarmed warm queries hold
 * SDK session ids the live index can't know yet (their resume token reaches the DB only when an
 * assistant row persists). Orphans older than this are collected on a later sweep.
 */
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000

// Claude session ids (resume tokens) and Cherry session ids are both uuids; anything else in the
// swept stores was not written per-session and must be left alone (memory/, sessions-index.json…).
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GC Cherry's own CLAUDE_CONFIG_DIR (`feature.agents.claude.root`) — everything under it was
 * written by Cherry sessions, so absence from the live index means orphaned. The user's real
 * ~/.claude (external-CLI/login providers point the SDK there) is deliberately NOT swept: it also
 * holds their terminal CLI sessions and may reference Cherry installs this DB knows nothing about
 * (reinstall, second instance); Claude Code's own retention cleanup owns that dir.
 */
export async function sweepClaudeSessionFiles(live: AgentSessionLiveIndex): Promise<void> {
  await sweepConfigRoot(path.resolve(application.getPath('feature.agents.claude.root')), live)
}

/** Sweeps one CLAUDE_CONFIG_DIR root. Exported for tests; callers use {@link sweepClaudeSessionFiles}. */
export async function sweepConfigRoot(root: string, live: AgentSessionLiveIndex): Promise<void> {
  const projectsDir = path.join(root, 'projects')

  for (const name of await readdirSafe(projectsDir)) {
    const projectDir = path.join(projectsDir, name)

    // Claude's cwd-to-project encoding is lossy, so the directory name cannot prove whether a
    // project belongs to a system or user workspace. Always judge per resume token and retain the
    // 24-hour protection instead of recursively deleting a project directory by its encoded name.
    for (const entry of await readdirSafe(projectDir)) {
      const token = entry.endsWith('.jsonl') ? entry.slice(0, -'.jsonl'.length) : entry
      if (!SESSION_ID_RE.test(token) || live.isResumeTokenLive(token)) continue
      const target = path.join(projectDir, entry)
      if (await olderThanMinAge(target)) await remove(target)
    }
  }

  for (const store of ['session-env', 'file-history', 'tasks']) {
    const storeDir = path.join(root, store)
    for (const entry of await readdirSafe(storeDir)) {
      if (!SESSION_ID_RE.test(entry) || live.isResumeTokenLive(entry)) continue
      const target = path.join(storeDir, entry)
      if (await olderThanMinAge(target)) await remove(target)
    }
  }

  // Todo files are named `<sessionId>-agent-<agentId>.json` — judge by the leading uuid.
  const todosDir = path.join(root, 'todos')
  for (const entry of await readdirSafe(todosDir)) {
    const token = entry.slice(0, 36)
    if (!SESSION_ID_RE.test(token) || live.isResumeTokenLive(token)) continue
    const target = path.join(todosDir, entry)
    if (await olderThanMinAge(target)) await remove(target)
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function olderThanMinAge(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target)
    return Date.now() - stat.mtimeMs > SWEEP_MIN_AGE_MS
  } catch {
    return false
  }
}

async function remove(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true })
    logger.info('Swept orphaned Claude session file', { target })
  } catch (error) {
    logger.warn('Failed to sweep Claude session file', { target, error })
  }
}
