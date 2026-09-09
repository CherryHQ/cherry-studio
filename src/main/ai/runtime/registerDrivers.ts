import path from 'node:path'

import { application } from '@application'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { createClaudeCodeRuntimeDriver } from './claudeCode'
import { DshRuntimeDriver } from './dsh/DshRuntimeDriver'
import { listEntries, reclaimStale } from './orphanSessionReclaim'
import { PiRuntimeDriver } from './pi/PiRuntimeDriver'
import { runtimeDriverRegistry } from './registry'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver,
  OrphanSessionReclaimOptions
} from './types'

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
    keptResumeTokens: ReadonlySet<string>,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }> {
    const projectsRoot = application.getPath('feature.agents.claude.projects')
    const removed: string[] = []

    for (const projectEntry of await listEntries(projectsRoot)) {
      if (!projectEntry.isDirectory()) continue
      const projectDir = path.resolve(projectsRoot, projectEntry.name)
      for (const entry of await listEntries(projectDir)) {
        // A project dir holds only `{id}.jsonl` and `{id}/`, so either names the session.
        // The dir has to stand on its own: its jsonl sibling may already be gone, and
        // keying solely off the file would strand the transcripts forever.
        const token = entry.isDirectory()
          ? entry.name
          : entry.name.endsWith('.jsonl')
            ? entry.name.slice(0, -'.jsonl'.length)
            : null
        if (!token || keptResumeTokens.has(token)) continue
        for (const target of [path.resolve(projectDir, `${token}.jsonl`), path.resolve(projectDir, token)]) {
          if (await reclaimStale(target, options)) removed.push(target)
        }
      }
    }

    return { removed }
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
  runtimeDriverRegistry.register(new DshRuntimeDriver())
}
