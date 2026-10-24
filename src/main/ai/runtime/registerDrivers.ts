import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveRealOrNearestExistingPath } from '@main/ai/agents/agentDataDirectory'
import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '@main/ai/runtime/fork'
import { claudeProjectDirectoryName } from '@main/ai/utils/claudeProject'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { createClaudeCodeRuntimeDriver, readClaudeTranscriptEvidence } from './claudeCode'
import { listEntries, reclaimStale } from './orphanSessionReclaim'
import { PiRuntimeDriver } from './pi/PiRuntimeDriver'
import { runtimeDriverRegistry } from './registry'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver,
  OrphanSessionKeepSet,
  OrphanSessionReclaimOptions
} from './types'

const UUID_SESSION_ARTIFACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const logger = loggerService.withContext('LazyClaudeCodeRuntimeDriver')

class LazyClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'claude-code'
  readonly capabilities = ['agent-session'] as const

  private implementationPromise: Promise<AgentSessionRuntimeDriver> | undefined

  validateSession(session: AgentSessionEntity): Promise<void> {
    return this.loadImplementation().then((driver) => driver.validateSession(session))
  }

  listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    return this.loadImplementation().then((driver) => driver.listAvailableTools(mcpIds))
  }

  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return this.loadImplementation().then((driver) => driver.connect(input))
  }

  async fork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
    input.signal.throwIfAborted()
    const driver = await this.loadImplementation()
    input.signal.throwIfAborted()
    if (!driver.fork) throw new AgentSessionForkError('unsupported_checkpoint')
    return driver.fork(input)
  }

  onSessionIdle(sessionId: string): void {
    void this.loadImplementation().then((driver) => driver.onSessionIdle?.(sessionId))
  }

  /**
   * Claude Code stores `{projects}/{cwd-slug}/{sessionId}.jsonl` plus a
   * `{sessionId}/` subagent-transcript directory, both keyed by the session id
   * Cherry persists as the resume token — so this mirrors the SDK's own
   * `deleteSession`, scoped to Cherry's config dir.
   *
   * It is deliberately NOT the SDK call: `listSessions` / `deleteSession`
   * resolve the config dir from the *calling* process's `CLAUDE_CONFIG_DIR`,
   * which Cherry only ever sets on the spawned child — in-process they would
   * reach the user's own `~/.claude`. Sessions run under the Claude-login
   * provider live there by design and are never swept.
   *
   * Runs without loading the implementation: this is pure filesystem work.
   */
  async reclaimOrphanSessions(
    keep: OrphanSessionKeepSet,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }> {
    const projectsRoot = application.getPath('feature.agents.claude.projects')
    const removed: string[] = []
    const ownedProjects = new Set<string>()
    // The runtime passes the stored spelling; the SDK hashes the realpath/NFC spelling.
    for (const workspacePath of keep.liveWorkspacePaths) {
      const resolved = path.normalize(await resolveRealOrNearestExistingPath(workspacePath))
      for (const spelling of [
        path.resolve(workspacePath),
        resolved,
        process.platform === 'darwin' ? resolved.normalize('NFC') : resolved
      ]) {
        ownedProjects.add(claudeProjectDirectoryName(spelling))
      }
    }

    for (const projectEntry of await listEntries(projectsRoot)) {
      if (!projectEntry.isDirectory() || ownedProjects.has(projectEntry.name)) continue
      const projectDir = path.resolve(projectsRoot, projectEntry.name)
      for (const entry of await listEntries(projectDir)) {
        // A UUID directory remains reclaimable after its transcript sibling is gone.
        const token = entry.isDirectory()
          ? entry.name
          : entry.name.endsWith('.jsonl')
            ? entry.name.slice(0, -'.jsonl'.length)
            : null
        if (!token || !UUID_SESSION_ARTIFACT.test(token) || keep.resumeTokens.has(token)) continue
        for (const target of [path.resolve(projectDir, `${token}.jsonl`), path.resolve(projectDir, token)]) {
          if (await reclaimStale(target, options)) removed.push(target)
        }
      }
    }

    return { removed }
  }

  async reclaimPurgedSessions(purgedResumeTokens: ReadonlySet<string>): Promise<{ removed: string[] }> {
    const projectsRoot = application.getPath('feature.agents.claude.projects')
    const removed: string[] = []

    for (const projectEntry of await listEntries(projectsRoot)) {
      if (!projectEntry.isDirectory()) continue
      const projectDir = path.resolve(projectsRoot, projectEntry.name)
      let removedFromProject = false
      for (const entry of await listEntries(projectDir)) {
        const token = entry.isDirectory()
          ? entry.name
          : entry.isFile() && entry.name.endsWith('.jsonl')
            ? entry.name.slice(0, -'.jsonl'.length)
            : null
        if (!token || !purgedResumeTokens.has(token)) continue

        const target = path.resolve(projectDir, entry.name)
        try {
          await fs.rm(target, { recursive: true, force: true })
          removed.push(target)
          removedFromProject = true
        } catch (error) {
          logger.warn('Failed to reclaim purged session artifact — retried next sweep', { target, error })
        }
      }
      if (!removedFromProject) continue
      try {
        await fs.rmdir(projectDir)
        removed.push(projectDir)
      } catch (error) {
        if (!['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          logger.warn('Failed to remove empty Claude project directory', { projectDir, error })
        }
      }
    }

    return { removed }
  }

  /** Pure filesystem work like the sweep above, so it never loads the implementation either. */
  readTranscriptEvidence(resumeToken: string, maxEntries: number): Promise<Record<string, unknown>[] | undefined> {
    return readClaudeTranscriptEvidence(application.getPath('feature.agents.claude.projects'), resumeToken, maxEntries)
  }

  private loadImplementation(): Promise<AgentSessionRuntimeDriver> {
    this.implementationPromise ??= createClaudeCodeRuntimeDriver()
    return this.implementationPromise
  }
}

/** Register every built-in runtime at the AgentSessionRuntimeService lifecycle boundary. */
export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(new LazyClaudeCodeRuntimeDriver())
  runtimeDriverRegistry.register(new PiRuntimeDriver())
}
