import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { Context } from '@deepseek-ai/cordis'
import {
  interruptedTurnClosers,
  type SessionEvent,
  SessionId,
  SessionLogOffset,
  SessionStore
} from '@deepseek-ai/dsh-session'
import { releasedV0SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

export interface DshForkInput {
  sourceRoot: string
  targetRoot: string
  sourceSessionId: string
  targetSessionId: string
  targetCwd: string
  boundary: number
  formatVersion: 0 | 4
  checkpoints: Array<{ boundary: number; formatVersion: 0 | 4 }>
}

export function createForkCheckpoint(events: readonly SessionEvent[], boundary: number) {
  const prefix = events.slice(0, boundary + 1)
  if (
    !Number.isSafeInteger(boundary) ||
    boundary < 0 ||
    prefix.length !== boundary + 1 ||
    prefix.at(-1)?.type !== 'turn/end' ||
    prefix.at(-1)?.seq !== boundary
  )
    throw new Error('history_changed')
  if (prefix.some((event, index) => event.seq !== index) || interruptedTurnClosers(prefix).length)
    throw new Error('history_corrupt')
  // Hash logical events independently of object insertion order in the storage codec.
  const canonical = JSON.stringify(prefix, (_key, value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  )
  return { boundary, prefixHash: createHash('sha256').update(canonical).digest('hex') }
}

/** This context deliberately has no Agent, loop, tools, goals or subagent services. */
export async function forkSession(
  input: DshForkInput
): Promise<{ path: string; checkpoints: Array<{ boundary: number; formatVersion: 4 }> }> {
  const source = new Context()
  const target = new Context()
  try {
    await source.plugin(SessionStore)
    await source.plugin(JsonlSessionPersistence, { root: input.sourceRoot })
    await target.plugin(SessionStore)
    await target.plugin(JsonlSessionPersistence, { root: input.targetRoot })
    const reader = await source.sessionPersistence.open(SessionId(input.sourceSessionId), 'read').catch((error) => {
      if (error instanceof SessionPersistenceNotFoundError) throw new Error('history_missing')
      throw error
    })
    const { events: history } = await reader.read()
    await reader.close()
    const legacy = [input, ...input.checkpoints].filter((checkpoint) => checkpoint.formatVersion === 0)
    const remapped = legacy.length
      ? await remapLegacyBoundaries(
          input,
          history,
          legacy.map((checkpoint) => checkpoint.boundary)
        )
      : new Map<number, number>()
    const boundary = input.formatVersion === 0 ? remapped.get(input.boundary)! : input.boundary
    const checkpoints = input.checkpoints.map((checkpoint) => ({
      boundary: checkpoint.formatVersion === 0 ? remapped.get(checkpoint.boundary)! : checkpoint.boundary,
      formatVersion: 4 as const
    }))
    const events = history.slice(0, boundary + 1)
    const { prefixHash } = createForkCheckpoint(events, boundary)
    for (const checkpoint of checkpoints) createForkCheckpoint(events, checkpoint.boundary)
    // SessionStore validates and owns a detached copy of the full event graph.
    const child = target.sessions.create(SessionId(input.targetSessionId), {
      seed: events,
      inheritedEventCount: SessionLogOffset(events.length),
      meta: { cwd: input.targetCwd, isSeeded: true }
    })
    if (createForkCheckpoint(child.snapshotEvents(), boundary).prefixHash !== prefixHash)
      throw new Error('history_corrupt')
    if (child.header.cwd !== input.targetCwd || child.id !== input.targetSessionId) {
      throw new Error('history_corrupt')
    }
    const writer = await target.sessionPersistence.create(child.header, {
      inheritedEventCount: SessionLogOffset(events.length)
    })
    await writer.append(child.snapshotEvents())
    await writer.close()
    // The staging root contains only this fork; storage owns the versioned artifact's name.
    const artifacts = (await readdir(input.targetRoot, { recursive: true })).filter((file) =>
      file.endsWith('.jsonl.zstd')
    )
    if (artifacts.length !== 1) throw new Error('Unsupported DSH storage')
    return { path: path.join(input.targetRoot, artifacts[0]), checkpoints }
  } finally {
    await Promise.all([target.fiber.dispose(), source.fiber.dispose()])
  }
}

/** Recover old checkpoint identities from the immutable v0 artifact retained by DSH migration. */
async function remapLegacyBoundaries(
  input: DshForkInput,
  events: readonly SessionEvent[],
  boundaries: number[]
): Promise<Map<number, number>> {
  const artifacts = (await readdir(input.sourceRoot, { recursive: true })).filter(
    (file) =>
      path.basename(path.dirname(file)) === input.sourceSessionId && path.basename(file) === 'session.jsonl.zstd'
  )
  if (artifacts.length !== 1) throw new Error('history_missing')
  const bytes = await readFile(path.join(input.sourceRoot, artifacts[0]))
  let decoder: ReturnType<typeof releasedV0SessionFormatCodec.createDecoder> | undefined
  const remapped = new Map<number, number>()
  const wanted = new Set(boundaries)
  for (let offset = 0; offset < bytes.length;) {
    const frame = zstdDecompressSync(bytes.subarray(offset), { info: true }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    offset += frame.engine.bytesWritten
    for (const row of frame.buffer.toString('utf8').trimEnd().split('\n')) {
      if (!decoder) {
        decoder = releasedV0SessionFormatCodec.createDecoder(JSON.parse(row), 'strict')
        if (decoder.header.id !== input.sourceSessionId) throw new Error('history_corrupt')
        continue
      }
      decoder.decodeRow(JSON.parse(row), {
        emitEvent(event) {
          if (!wanted.has(event.seq)) return
          if (event.type !== 'turn/end' || !event.data || typeof event.data !== 'object' || !('turn' in event.data))
            throw new Error('history_changed')
          const turn = event.data.turn
          const matches = events.filter(
            (candidate) =>
              candidate.type === 'turn/end' && candidate.time === event.time && candidate.data.turn === turn
          )
          if (matches.length !== 1) throw new Error('history_changed')
          remapped.set(event.seq, matches[0].seq)
        },
        emitRun() {}
      })
      if (remapped.size === wanted.size) return remapped
    }
  }
  throw new Error('history_changed')
}
