import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeForkCheckpoint } from './forkCheckpoint'
import { validateForkClosure } from './forkValidation.ts'

export interface ClaudeForkWorkerInput {
  entries: SessionStoreEntry[]
  checkpoint: ClaudeForkCheckpoint
  checkpoints: ClaudeForkCheckpoint[]
  checkpointEntryCounts?: number[]
  artifactDirectory: string
  targetCwd: string
}

async function run(input: ClaudeForkWorkerInput): Promise<unknown> {
  const { checkpoint } = input
  const sourceIds = new Set<string>()
  const mainEntries = input.entries.filter((entry) => !entry.isSidechain)
  for (const entry of mainEntries) {
    if (entry.uuid) {
      if (sourceIds.has(entry.uuid)) throw new Error('history_corrupt')
      sourceIds.add(entry.uuid)
    }
    for (const key of ['parentUuid', 'logicalParentUuid']) {
      const reference = entry[key]
      if (typeof reference === 'string' && !sourceIds.has(reference)) throw new Error('history_corrupt')
    }
  }
  // env is a worker-private copy, set before importing the SDK. Never use SHARE_ENV.
  process.env.CLAUDE_CONFIG_DIR = checkpoint.configDir
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const output: SessionStoreEntry[] = []
  let outputKey: SessionKey | undefined
  const store: SessionStore = {
    async load(key) {
      return key.sessionId === checkpoint.runtimeSessionId ? structuredClone(input.entries) : null
    },
    async append(key, entries) {
      if (key.sessionId === checkpoint.runtimeSessionId || (outputKey && outputKey.sessionId !== key.sessionId)) {
        throw new Error('history_corrupt')
      }
      outputKey = key
      output.push(...structuredClone(entries))
    }
  }
  // Original UUIDs enter once; only the SDK creates the new UUIDs.
  const result = await sdk.forkSession(checkpoint.runtimeSessionId, {
    // The fixed store supplies the source prefix in the target project's namespace.
    // Let the public SDK choose projectKey; do not duplicate its directory encoder.
    dir: input.targetCwd,
    sessionStore: store,
    upToMessageId: checkpoint.messageUuid
  })
  if (outputKey?.sessionId !== result.sessionId || !output.length) throw new Error('history_corrupt')
  if (!outputKey.projectKey || path.basename(outputKey.projectKey) !== outputKey.projectKey) {
    throw new Error('history_corrupt')
  }
  const mapping = validateForkClosure(input.entries, output, checkpoint.runtimeSessionId)
  const replacements = input.entries
    .filter((entry) => entry.type === 'content-replacement')
    .flatMap((entry) => (Array.isArray(entry.replacements) ? entry.replacements : []))
  let messages: Awaited<ReturnType<typeof sdk.getSessionMessages>>
  try {
    messages = await sdk.getSessionMessages(checkpoint.runtimeSessionId, {
      dir: input.targetCwd,
      includeSystemMessages: true,
      sessionStore: { load: async () => structuredClone(input.entries), append: async () => {} }
    })
  } catch {
    throw new Error('unsupported_checkpoint')
  }
  if (!messages.length) throw new Error('unsupported_checkpoint')
  const boundaries = messages.flatMap((message, index) => {
    const record = input.entries.find((entry) => entry.uuid === message.uuid)
    if (record?.type !== 'system' || record.subtype !== 'compact_boundary') return []
    const uuid = mapping.get(message.uuid)
    if (!uuid) throw new Error('history_corrupt')
    return [{ uuid, index }]
  })
  // The public SDK moves replacement records to the tail. An earlier inherited prefix
  // must not silently lose replacements that already existed at its checkpoint.
  for (const [index, value] of input.checkpoints.entries()) {
    if (value.messageUuid === checkpoint.messageUuid) continue
    if (replacements.length && !input.checkpointEntryCounts) throw new Error('unsupported_checkpoint')
    for (const entry of input.entries.slice(0, input.checkpointEntryCounts?.[index] ?? 0)) {
      if (entry.type === 'content-replacement') throw new Error('unsupported_checkpoint')
    }
  }
  const chunks = output.map((entry) => Buffer.from(JSON.stringify(entry) + '\n'))
  const bytes = Buffer.concat(chunks)
  const checkpoints = input.checkpoints.map((value) => {
    const uuid = mapping.get(value.messageUuid)
    const end = output.findIndex((entry) => entry.uuid === uuid)
    if (!uuid || end < 0) throw new Error('history_corrupt')
    return {
      ...value,
      runtimeSessionId: result.sessionId,
      messageUuid: uuid
    }
  })
  await mkdir(input.artifactDirectory, { recursive: true })
  const file = path.join(input.artifactDirectory, result.sessionId + '.jsonl')
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  return {
    expectation: { messageCount: messages.length, boundaries },
    resumeToken: result.sessionId,
    checkpoints,
    publish: [
      {
        source: file,
        target: path.join(checkpoint.configDir, 'projects', outputKey.projectKey, result.sessionId + '.jsonl')
      }
    ]
  }
}

void run(workerData as ClaudeForkWorkerInput).then(
  (result) => parentPort?.postMessage({ result }),
  (error) =>
    parentPort?.postMessage({
      error:
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 'history_missing'
          : error instanceof SyntaxError
            ? 'history_corrupt'
            : error instanceof Error
              ? error.message
              : 'history_corrupt'
    })
)
