import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { listEntries, reclaimStale } from '../orphanSessionReclaim'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver,
  OrphanSessionReclaimOptions
} from '../types'
import { PiForkCheckpointSchema } from './forkCheckpoint'
import { forkPiSession } from './piFork'
import { PiRuntimeConnection } from './PiRuntimeConnection'
import { ensureRetiredSessionHistory, migrateRetiredSessionHistories } from './retiredSessionHistory'
import { piWorkspaceRelocation } from './workspaceRelocation'

export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly workspaceRelocation = piWorkspaceRelocation
  readonly type = 'pi'
  readonly fork = forkPiSession
  isForkCheckpoint(value: unknown): boolean {
    return PiForkCheckpointSchema.safeParse(value).success
  }
  readonly recoverSessions = migrateRetiredSessionHistories

  async validateSession(session: AgentSessionEntity): Promise<void> {
    await ensureRetiredSessionHistory(session.id)
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`pi agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`pi agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const migration = getRetiredAgentSessionMigration(application.get('DbService').getDb(), input.sessionId)
    await ensureRetiredSessionHistory(input.sessionId)
    const migratedInput = migration
      ? {
          ...input,
          resumeToken: agentSessionMessageService.getLastRuntimeResumeToken(input.sessionId) ?? undefined,
          nativeSessionId: undefined
        }
      : input
    const connection = new PiRuntimeConnection(migratedInput)
    try {
      return await connection.start()
    } catch (error) {
      await connection.close()
      throw error
    }
  }

  /**
   * pi keeps one flat `{timestamp}_{resumeToken}.jsonl` per session generation
   * (see `resolveResumeTokenSessionFile`), so the token is the stem after the
   * FIRST `_` — the timestamp pi owns has none, but a token legally can. Every
   * file for a claimed token is kept; ambiguous identities fail closed when opening.
   */
  async reclaimOrphanSessions(
    keptResumeTokens: ReadonlySet<string>,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }> {
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    const removed: string[] = []

    for (const entry of await listEntries(sessionDir)) {
      if (!entry.isFile()) continue
      const token = piResumeTokenOf(entry.name)
      if (!token || keptResumeTokens.has(token)) continue
      const target = path.resolve(sessionDir, entry.name)
      if (await reclaimStale(target, options)) removed.push(target)
    }

    return { removed }
  }
}

/**
 * `{timestamp}_{resumeToken}.jsonl` → the token, or null when the name is not pi's.
 * Splits on the FIRST `_`: pi's timestamp prefix is dash-only, but `_` is a legal
 * token character, so splitting on the last one truncates the token and would
 * make a still-claimed session look orphaned.
 */
function piResumeTokenOf(fileName: string): string | null {
  if (!fileName.endsWith('.jsonl')) return null
  const stem = fileName.slice(0, -'.jsonl'.length)
  const separator = stem.indexOf('_')
  if (separator < 0) return null
  const token = stem.slice(separator + 1)
  return token.length > 0 ? token : null
}
