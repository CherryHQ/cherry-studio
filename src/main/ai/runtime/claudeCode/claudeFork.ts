import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import { readForkPrefix, readNativeForkHistory } from '../../agentSession/forkFiles'
import {
  AgentSessionForkError,
  FORK_CHECKPOINT_FAILED,
  type RuntimeForkInput,
  type RuntimeForkResult,
  type RuntimeForkState
} from '../forkCheckpoint'
import { runForkWorker } from '../runForkWorker'

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

export async function captureClaudeForkCheckpoint(
  runtimeSessionId: string,
  messageUuid: string | undefined,
  configDir: string,
  sourceCwd: string
): Promise<RuntimeForkState> {
  try {
    if (!messageUuid) return FORK_CHECKPOINT_FAILED
    const bytes = await readForkPrefix(await findSession(configDir, runtimeSessionId))
    const entries = bytes
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as SessionStoreEntry)
    if (!entries.some((entry) => entry.uuid === messageUuid && entry.type === 'assistant' && !entry.isSidechain)) {
      return FORK_CHECKPOINT_FAILED
    }
    return {
      version: 1,
      status: 'available',
      checkpoint: {
        runtime: 'claude-code',
        runtimeSessionId,
        messageUuid,
        configDir,
        sourceCwd,
        prefixBytes: bytes.length,
        prefixHash: createHash('sha256').update(bytes).digest('hex')
      }
    }
  } catch {
    // Failure to capture native history must not turn a successful answer into an error.
    return FORK_CHECKPOINT_FAILED
  }
}

export async function forkClaudeSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  return readNativeForkHistory(() => prepareClaudeFork(input))
}

async function prepareClaudeFork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = input.checkpoint
  if (checkpoint.runtime !== 'claude-code') throw new AgentSessionForkError('unsupported_checkpoint')
  const file = await findSession(checkpoint.configDir, checkpoint.runtimeSessionId)
  const bytes = await readForkPrefix(file, checkpoint.prefixBytes)
  if (createHash('sha256').update(bytes).digest('hex') !== checkpoint.prefixHash) {
    throw new AgentSessionForkError('history_changed')
  }
  const entries = bytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as SessionStoreEntry)
  const checkpoints = input.checkpoints.map((value) => {
    if (value.runtime !== 'claude-code' || value.runtimeSessionId !== checkpoint.runtimeSessionId) {
      throw new AgentSessionForkError('history_changed')
    }
    return value
  })
  // Use offsets in the original byte stream, not reserialized JSON lengths (which
  // may differ for whitespace or CRLF logs).
  const entryCounts = new Map<number, number>()
  let entryCount = 0
  for (let offset = bytes.indexOf(10); offset >= 0; offset = bytes.indexOf(10, offset + 1)) {
    entryCounts.set(offset + 1, ++entryCount)
  }
  const checkpointEntryCounts = checkpoints.map((value) => {
    const count = entryCounts.get(value.prefixBytes)
    if (!count) throw new AgentSessionForkError('history_changed')
    return count
  })
  return runForkWorker<RuntimeForkResult>(
    {
      runtime: 'claude-code',
      entries,
      checkpoint,
      checkpoints,
      checkpointEntryCounts,
      artifactDirectory: path.join(input.artifactDirectory, 'claude'),
      targetCwd: input.targetCwd
    },
    input.signal
  )
}
