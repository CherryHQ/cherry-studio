import { readdir } from 'node:fs/promises'
import path from 'node:path'

import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import { readForkPrefix, readNativeForkHistory } from '@main/ai/runtime/fork'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
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
