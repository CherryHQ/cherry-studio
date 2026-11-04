import type { FileEntry } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { AgentSessionForkError, readForkPrefix, type RuntimeForkProbeCandidate } from '@main/ai/runtime/fork'
import { isAgentSessionForkFailureReason, type AgentSessionForkAvailabilityDecision } from '@shared/ai/agentSessionFork'

import { parsePiForkCheckpoint } from './forkCheckpoint'
import { loadPiSdk } from './piSdk'
import { resolveResumeTokenSessionFile } from './piSessionFile'

export async function probePiFork(candidates: readonly RuntimeForkProbeCandidate[]) {
  const results = new Map<string, AgentSessionForkAvailabilityDecision>()
  const groups = new Map<
    string,
    Array<{ candidate: RuntimeForkProbeCandidate; checkpoint: ReturnType<typeof parsePiForkCheckpoint> }>
  >()
  const fail = (id: string, error: unknown) => {
    const reason = error instanceof AgentSessionForkError ? error.reason : undefined
    results.set(
      id,
      reason && isAgentSessionForkFailureReason(reason)
        ? { enabled: false, reason }
        : { enabled: null, reason: 'operation_failed' }
    )
  }
  for (const candidate of candidates) {
    try {
      const checkpoint = parsePiForkCheckpoint(candidate.checkpoint)
      if (!/^[a-zA-Z0-9-]+$/.test(checkpoint.runtimeSessionId)) throw new AgentSessionForkError('history_corrupt')
      const file = resolveResumeTokenSessionFile(
        checkpoint.runtimeSessionId,
        application.getPath('feature.agents.pi.sessions')
      )
      if (!file) throw new AgentSessionForkError('history_missing')
      const group = groups.get(file) ?? []
      group.push({ candidate, checkpoint })
      groups.set(file, group)
    } catch (error) {
      fail(candidate.messageId, error)
    }
  }
  for (const [file, group] of groups) {
    try {
      const read = async (length?: number) => {
        try {
          return await readForkPrefix(file, length)
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new AgentSessionForkError('history_missing')
          throw error
        }
      }
      const source = await read()
      let entries: FileEntry[]
      try {
        entries = source
          .toString('utf8')
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line) as FileEntry)
      } catch (error) {
        if (error instanceof SyntaxError) throw new AgentSessionForkError('history_corrupt')
        throw error
      }
      if (!source.equals(await read(source.length))) throw new AgentSessionForkError('history_changed')
      if (!entries[0] || entries[0].type !== 'session' || typeof entries[0].id !== 'string')
        throw new Error('Missing session header')
      const sdk = await loadPiSdk()
      for (const { candidate, checkpoint } of group) {
        try {
          const manager = sdk.SessionManager.inMemory(candidate.cwd, undefined, structuredClone(entries))
          if (manager.getSessionId() !== checkpoint.runtimeSessionId || !manager.getEntry(checkpoint.leafId))
            throw new AgentSessionForkError('history_changed')
          manager.createBranchedSession(checkpoint.leafId)
          for (const ancestor of candidate.checkpoints.map(parsePiForkCheckpoint)) {
            if (ancestor.runtimeSessionId !== checkpoint.runtimeSessionId || !manager.getEntry(ancestor.leafId))
              throw new AgentSessionForkError('history_corrupt')
          }
          results.set(candidate.messageId, { enabled: true })
        } catch (error) {
          fail(candidate.messageId, error)
        }
      }
    } catch (error) {
      for (const { candidate } of group) fail(candidate.messageId, error)
    }
  }
  return results
}
