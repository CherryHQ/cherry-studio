import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import type { RuntimeForkCheckpoint } from './forkCheckpoint'

export type ForkWorkerInput =
  | {
      runtime: 'dsh-context'
      modulePath: string
      events: unknown[]
      boundary: number
    }
  | {
      runtime: 'claude-code'
      entries: SessionStoreEntry[]
      checkpoint: Extract<RuntimeForkCheckpoint, { runtime: 'claude-code' }>
      checkpoints: Extract<RuntimeForkCheckpoint, { runtime: 'claude-code' }>[]
      checkpointEntryCounts?: number[]
      artifactDirectory: string
      targetCwd: string
    }
  | {
      runtime: 'dsh'
      modulePath: string
      sourceRoot: string
      targetRoot: string
      sourceSessionId: string
      targetSessionId: string
      targetCwd: string
      boundary: number
      events?: unknown[]
    }

async function run(input: ForkWorkerInput): Promise<unknown> {
  if (input.runtime === 'dsh-context') {
    const sdk = await import(/* @vite-ignore */ input.modulePath)
    return sdk.readForkContext(input)
  }
  if (input.runtime === 'dsh') {
    const sdk = await import(/* @vite-ignore */ input.modulePath)
    return sdk.forkSession(input)
  }
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
  const mapping = new Map<string, string>()
  for (const entry of output) {
    const from = entry.forkedFrom as { sessionId?: string; messageUuid?: string } | undefined
    if (from?.sessionId === checkpoint.runtimeSessionId && from.messageUuid && entry.uuid) {
      if (mapping.has(from.messageUuid)) throw new Error('history_corrupt')
      mapping.set(from.messageUuid, entry.uuid)
    }
  }
  // Verify the opaque compaction records survive SDK processing. Fail closed rather than
  // silently resume with a different context if an SDK version drops required metadata.
  for (const source of input.entries) {
    if (!source.compactMetadata || !source.uuid) continue
    const mapped = output.find((entry) => entry.uuid === mapping.get(source.uuid!))
    if (!mapped || JSON.stringify(mapped.compactMetadata) !== JSON.stringify(source.compactMetadata)) {
      throw new Error('unsupported_checkpoint')
    }
    // Some SDK releases copy preserved-segment UUIDs verbatim. Do not publish dangling
    // compaction references, and do not allocate a second set of UUIDs to repair them.
    if (containsSourceUuid(mapped.compactMetadata, sourceIds)) throw new Error('unsupported_checkpoint')
  }
  const replacements = input.entries
    .filter((entry) => entry.type === 'content-replacement')
    .flatMap((entry) => (Array.isArray(entry.replacements) ? entry.replacements : []))
  const copiedReplacements = output
    .filter((entry) => entry.type === 'content-replacement')
    .flatMap((entry) => (Array.isArray(entry.replacements) ? entry.replacements : []))
  if (
    JSON.stringify(replacements) !== JSON.stringify(copiedReplacements) ||
    containsSourceUuid(copiedReplacements, sourceIds)
  )
    throw new Error('unsupported_checkpoint')
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
    const prefix = value.messageUuid === checkpoint.messageUuid ? bytes : Buffer.concat(chunks.slice(0, end + 1))
    return {
      ...value,
      runtimeSessionId: result.sessionId,
      messageUuid: uuid,
      sourceCwd: input.targetCwd,
      prefixBytes: prefix.length,
      prefixHash: createHash('sha256').update(prefix).digest('hex')
    }
  })
  await mkdir(input.artifactDirectory, { recursive: true })
  const file = path.join(input.artifactDirectory, result.sessionId + '.jsonl')
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  return {
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

function containsSourceUuid(value: unknown, sourceIds: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return sourceIds.has(value)
  if (Array.isArray(value)) return value.some((item) => containsSourceUuid(item, sourceIds))
  if (value && typeof value === 'object')
    return Object.entries(value).some(([key, item]) => sourceIds.has(key) || containsSourceUuid(item, sourceIds))
  return false
}

void run(workerData as ForkWorkerInput).then(
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
