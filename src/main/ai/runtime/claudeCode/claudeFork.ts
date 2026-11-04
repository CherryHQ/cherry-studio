import { readdir } from 'node:fs/promises'
import path from 'node:path'

import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import { readForkPrefix, readNativeForkHistory } from '@main/ai/runtime/fork'
import { isAgentSessionForkFailureReason, type AgentSessionForkAvailabilityDecision } from '@shared/ai/agentSessionFork'

import {
  AgentSessionForkError,
  type RuntimeForkInput,
  type RuntimeForkProbeCandidate,
  type RuntimeForkResult
} from '../fork'
import { runForkWorker } from '../fork'
import { ClaudeForkResultSchema, parseClaudeForkCheckpoint } from './forkCheckpoint'
import type { ClaudeForkWorkerInput } from './forkWorker'

async function findSession(configDir: string, sessionId: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new AgentSessionForkError('history_corrupt')
  const root = path.join(configDir, 'projects')
  const files: string[] = []
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue
    const directory = path.join(root, project.name)
    if ((await readdir(directory)).includes(sessionId + '.jsonl'))
      files.push(path.join(directory, sessionId + '.jsonl'))
  }
  if (files.length !== 1) throw new AgentSessionForkError(files.length ? 'history_corrupt' : 'history_missing')
  return files[0]
}

export async function forkClaudeSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  return readNativeForkHistory(() => prepareClaudeFork(input))
}

async function prepareClaudeFork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = parseClaudeForkCheckpoint(input.checkpoint)
  const file = await findSession(checkpoint.configDir, checkpoint.runtimeSessionId)
  const bytes = await readForkPrefix(file)
  const entries: SessionStoreEntry[] = []
  let start = 0
  let end = 0
  for (end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, start)) {
    const entry = JSON.parse(bytes.toString('utf8', start, end)) as SessionStoreEntry
    start = end + 1
    entries.push(entry)
    if (entry.uuid === checkpoint.messageUuid && entry.type === 'assistant' && !entry.isSidechain) break
  }
  if (end < 0) throw new AgentSessionForkError('history_missing')
  if (!bytes.subarray(0, start).equals(await readForkPrefix(file, start)))
    throw new AgentSessionForkError('history_changed')
  const checkpoints = input.checkpoints.map(parseClaudeForkCheckpoint).map((value) => {
    if (value.runtimeSessionId !== checkpoint.runtimeSessionId) {
      throw new AgentSessionForkError('history_changed')
    }
    return value
  })
  const checkpointEntryCounts = checkpoints.map((value) => {
    const index = entries.findIndex(
      (entry) => entry.uuid === value.messageUuid && entry.type === 'assistant' && !entry.isSidechain
    )
    if (index < 0) throw new AgentSessionForkError('history_changed')
    return index + 1
  })
  const { default: createWorker } = await import('./forkWorker?nodeWorker')
  input.signal.throwIfAborted()
  const workerData: ClaudeForkWorkerInput = {
    entries,
    checkpoint,
    checkpoints,
    checkpointEntryCounts,
    artifactDirectory: path.join(input.artifactDirectory, 'claude'),
    targetCwd: input.targetCwd
  }
  const worker = createWorker({ workerData, env: { ...process.env } })
  const result = ClaudeForkResultSchema.safeParse(await runForkWorker(worker, input.signal))
  if (!result.success) throw new AgentSessionForkError('history_corrupt')
  return result.data
}

export async function probeClaudeFork(
  candidates: readonly RuntimeForkProbeCandidate[]
): Promise<ReadonlyMap<string, AgentSessionForkAvailabilityDecision>> {
  const results = new Map<string, AgentSessionForkAvailabilityDecision>()
  const groups = new Map<
    string,
    {
      file: string
      candidates: Array<{
        candidate: (typeof candidates)[number]
        checkpoint: ReturnType<typeof parseClaudeForkCheckpoint>
      }>
    }
  >()
  const failed = (id: string, error: unknown) => {
    const reason =
      error instanceof AgentSessionForkError
        ? error.reason
        : error instanceof SyntaxError
          ? 'history_corrupt'
          : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
            ? 'history_missing'
            : undefined
    results.set(
      id,
      reason && isAgentSessionForkFailureReason(reason)
        ? { enabled: false, reason }
        : { enabled: null, reason: 'operation_failed' }
    )
  }
  for (const candidate of candidates) {
    try {
      const checkpoint = parseClaudeForkCheckpoint(candidate.checkpoint)
      const key = JSON.stringify([checkpoint.configDir, checkpoint.runtimeSessionId])
      let group = groups.get(key)
      if (!group) {
        const file = await findSession(checkpoint.configDir, checkpoint.runtimeSessionId)
        group = { file, candidates: [] }
        groups.set(key, group)
      }
      group.candidates.push({ candidate, checkpoint })
    } catch (error) {
      failed(candidate.messageId, error)
    }
  }
  for (const { file, candidates: group } of groups.values()) {
    try {
      const bytes = await readForkPrefix(file)
      const boundaries = new Map<string, number>()
      const seen = new Map<string, number>()
      let start = 0
      let parseError: unknown
      for (let end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, start)) {
        try {
          const entry = JSON.parse(bytes.toString('utf8', start, end)) as SessionStoreEntry
          start = end + 1
          if (entry.type === 'assistant' && !entry.isSidechain && entry.uuid && !seen.has(entry.uuid))
            seen.set(entry.uuid, start)
          for (const { candidate, checkpoint } of group)
            if (!boundaries.has(candidate.messageId) && seen.has(checkpoint.messageUuid))
              boundaries.set(candidate.messageId, seen.get(checkpoint.messageUuid)!)
          if (boundaries.size === group.length) break
        } catch (error) {
          parseError = error
          break
        }
      }
      const max = Math.max(0, ...boundaries.values())
      let second: Buffer | undefined
      let readError: unknown
      if (max)
        try {
          second = await readForkPrefix(file, max)
        } catch (error) {
          readError = error
        }
      for (const { candidate, checkpoint } of group) {
        try {
          const boundary = boundaries.get(candidate.messageId)
          if (!boundary) throw parseError ?? new AgentSessionForkError('history_missing')
          let current = second
          if (!current)
            current = await readForkPrefix(file, boundary).catch(() => {
              throw readError
            })
          if (!bytes.subarray(0, boundary).equals(current.subarray(0, boundary)))
            throw new AgentSessionForkError('history_changed')
          for (const ancestor of candidate.checkpoints.map(parseClaudeForkCheckpoint)) {
            if (
              ancestor.runtimeSessionId !== checkpoint.runtimeSessionId ||
              (seen.get(ancestor.messageUuid) ?? Infinity) > boundary
            )
              throw new AgentSessionForkError('history_changed')
          }
          results.set(candidate.messageId, { enabled: true })
        } catch (error) {
          failed(candidate.messageId, error)
        }
      }
    } catch (error) {
      for (const { candidate } of group) failed(candidate.messageId, error)
    }
  }
  return results
}
