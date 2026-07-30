import path from 'node:path'

import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import {
  decodePortableAgentResumePoint,
  encodePortableAgentResumePoint,
  isPortableAgentResumeToken,
  type PortableAgentResumePoint
} from '@main/ai/agents/portableProfilePolicy'
import { atomicWriteFile, ensureDir, read } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import Database from 'better-sqlite3'

const TRANSCRIPT_FORMAT_VERSION = 1
const MAIN_TRANSCRIPT_KEY = ''
const MIRROR_WAIT_TIMEOUT_MS = 5_000

export { decodePortableAgentResumePoint, encodePortableAgentResumePoint, type PortableAgentResumePoint }

interface StoredTranscript {
  readonly version: 1
  readonly sessions: Record<string, Record<string, SessionStoreEntry[]>>
}

function asAbsolutePath(value: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(value)
}

function cloneEntries(entries: readonly SessionStoreEntry[]): SessionStoreEntry[] {
  return entries.map((entry) => structuredClone(entry))
}

function cloneSessions(
  sessions: Readonly<Record<string, Readonly<Record<string, readonly SessionStoreEntry[]>>>>
): StoredTranscript['sessions'] {
  return Object.fromEntries(
    Object.entries(sessions).map(([sessionId, transcripts]) => [
      sessionId,
      Object.fromEntries(Object.entries(transcripts).map(([subpath, entries]) => [subpath, cloneEntries(entries)]))
    ])
  )
}

function isSessionStoreEntry(value: unknown): value is SessionStoreEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).type === 'string'
  )
}

function parseStoredTranscript(raw: string): StoredTranscript {
  const value = JSON.parse(raw) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version !== TRANSCRIPT_FORMAT_VERSION
  ) {
    throw new Error('Unsupported portable Agent transcript')
  }

  const sessions = (value as Record<string, unknown>).sessions
  if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) {
    throw new Error('Malformed portable Agent transcript sessions')
  }

  for (const transcripts of Object.values(sessions)) {
    if (typeof transcripts !== 'object' || transcripts === null || Array.isArray(transcripts)) {
      throw new Error('Malformed portable Agent transcript session')
    }
    for (const entries of Object.values(transcripts)) {
      if (!Array.isArray(entries) || !entries.every(isSessionStoreEntry)) {
        throw new Error('Malformed portable Agent transcript entries')
      }
    }
  }

  return value as StoredTranscript
}

/**
 * Prove that an owner-committed transcript matches the resume point retained
 * by the detached main database.
 *
 * Backup supplies only paths and the detached DB; Agent owns the table lookup,
 * managed filename projection, transcript format, and boundary semantics.
 */
export async function assertPortableAgentTranscriptSnapshot(input: {
  readonly detachedDbPath: string
  readonly transcriptRoot: string
  readonly sourcePath: string
  readonly stagedPath: string
}): Promise<void> {
  const root = path.resolve(input.transcriptRoot)
  const source = path.resolve(input.sourcePath)
  if (path.dirname(source) !== root || path.extname(source) !== '.json') {
    throw new Error('Portable Agent transcript is outside its owner-managed root')
  }
  const hostSessionId = path.basename(source, '.json')

  const db = new Database(input.detachedDbPath, { fileMustExist: true, readonly: true })
  let token: string | null
  try {
    const row = db
      .prepare(
        `SELECT runtime_resume_token AS runtimeResumeToken
         FROM agent_session_message
         WHERE session_id = ? AND runtime_resume_token IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(hostSessionId) as { runtimeResumeToken: string } | undefined
    token = row?.runtimeResumeToken ?? null
  } finally {
    db.close()
  }

  if (!isPortableAgentResumeToken(token)) {
    throw new Error('Detached Agent session has no portable resume point')
  }
  const point = decodePortableAgentResumePoint(token)
  if (!point) throw new Error('Detached Agent session has no portable resume point')

  const transcript = parseStoredTranscript(await read(asAbsolutePath(input.stagedPath), { encoding: 'text' }))
  const main = transcript.sessions[point.sessionId]?.[MAIN_TRANSCRIPT_KEY]
  if (!main || main.length === 0) {
    throw new Error('Portable Agent transcript does not contain its retained session')
  }
  if (point.resumeSessionAt && main.at(-1)?.uuid !== point.resumeSessionAt) {
    throw new Error('Portable Agent transcript does not end at its retained Turn boundary')
  }
}

function transcriptKey(key: SessionKey): string {
  return key.subpath ?? MAIN_TRANSCRIPT_KEY
}

function appendDeduplicated(target: SessionStoreEntry[], additions: readonly SessionStoreEntry[]): void {
  const knownUuids = new Set(target.flatMap((entry) => (typeof entry.uuid === 'string' ? [entry.uuid] : [])))
  for (const entry of additions) {
    if (typeof entry.uuid === 'string') {
      if (knownUuids.has(entry.uuid)) continue
      knownUuids.add(entry.uuid)
    }
    target.push(structuredClone(entry))
  }
}

function assertSafeStorageSegment(value: string, label: string): void {
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error(`Invalid ${label} for portable Agent transcript`)
  }
}

/**
 * Claude's SDK dual-writes the live JSONL transcript to this owner store.
 * `append()` only updates an in-memory working copy. The driver calls
 * `commitTurn()` after a successful result, so the file transported by Backup
 * always ends at a completed Turn and never contains a half-written tool loop.
 *
 * The store deliberately ignores `projectKey`: one instance is already scoped
 * to a Cherry Agent session, and ignoring the cwd-derived key is what makes the
 * committed transcript portable when a managed workspace is rebased.
 */
export class PortableAgentTranscriptStore implements SessionStore {
  private loaded?: Promise<void>
  private committed: StoredTranscript['sessions'] = {}
  private working: StoredTranscript['sessions'] = {}
  private serial: Promise<void> = Promise.resolve()
  private readonly entryWaiters = new Set<() => void>()

  constructor(
    private readonly filePath: AbsoluteFilePath,
    private readonly directoryPath: AbsoluteFilePath
  ) {}

  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const transcripts = (this.working[key.sessionId] ??= {})
      const target = (transcripts[transcriptKey(key)] ??= [])
      appendDeduplicated(target, entries)
      for (const notify of this.entryWaiters) notify()
    })
  }

  load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      // A new SDK process must never inherit uncommitted entries left by a
      // failed/aborted connection in this process.
      this.working = cloneSessions(this.committed)
      const entries = this.committed[key.sessionId]?.[transcriptKey(key)]
      return entries ? cloneEntries(entries) : null
    })
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    await this.serial
    await this.ensureLoaded()
    return Object.keys(this.committed[key.sessionId] ?? {}).filter((subpath) => subpath !== MAIN_TRANSCRIPT_KEY)
  }

  async commitTurn(sessionId: string, resumeSessionAt?: string): Promise<void> {
    await this.serial
    await this.ensureLoaded()
    if (resumeSessionAt && !this.hasMainEntry(sessionId, resumeSessionAt)) {
      await this.waitForMainEntry(sessionId, resumeSessionAt)
    }

    await this.enqueue(async () => {
      await this.ensureLoaded()
      const workingSession = this.working[sessionId]
      const main = workingSession?.[MAIN_TRANSCRIPT_KEY]
      if (!workingSession || !main) {
        throw new Error('Claude transcript mirror has no main transcript for the completed Turn')
      }

      let committedMain = main
      if (resumeSessionAt) {
        const boundary = main.findIndex((entry) => entry.uuid === resumeSessionAt)
        if (boundary < 0) {
          throw new Error('Claude transcript mirror is missing the completed Turn boundary')
        }
        committedMain = main.slice(0, boundary + 1)
      }

      const nextCommitted = cloneSessions(this.committed)
      nextCommitted[sessionId] = cloneSessions({
        [sessionId]: {
          ...workingSession,
          [MAIN_TRANSCRIPT_KEY]: committedMain
        }
      })[sessionId]

      await ensureDir(this.directoryPath)
      await atomicWriteFile(
        this.filePath,
        JSON.stringify({ version: TRANSCRIPT_FORMAT_VERSION, sessions: nextCommitted } satisfies StoredTranscript),
        { mode: 0o600, directorySync: 'required' }
      )
      this.committed = nextCommitted
      this.working = cloneSessions(nextCommitted)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation)
    this.serial = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const stored = parseStoredTranscript(await read(this.filePath, { encoding: 'text' }))
          this.committed = cloneSessions(stored.sessions)
          this.working = cloneSessions(stored.sessions)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      })()
    }
    return this.loaded
  }

  private hasMainEntry(sessionId: string, uuid: string): boolean {
    return this.working[sessionId]?.[MAIN_TRANSCRIPT_KEY]?.some((entry) => entry.uuid === uuid) ?? false
  }

  private waitForMainEntry(sessionId: string, uuid: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!this.hasMainEntry(sessionId, uuid)) return
        clearTimeout(timer)
        this.entryWaiters.delete(check)
        resolve()
      }
      const timer = setTimeout(() => {
        this.entryWaiters.delete(check)
        reject(new Error('Timed out waiting for Claude transcript mirror to reach the completed Turn'))
      }, MIRROR_WAIT_TIMEOUT_MS)
      timer.unref?.()
      this.entryWaiters.add(check)
      check()
    })
  }
}

const storeRefs = new Map<string, WeakRef<PortableAgentTranscriptStore>>()

export function getPortableAgentTranscriptStore(hostSessionId: string): PortableAgentTranscriptStore {
  assertSafeStorageSegment(hostSessionId, 'Agent session id')
  const cacheKey = hostSessionId
  const existing = storeRefs.get(cacheKey)?.deref()
  if (existing) return existing

  const directoryPath = asAbsolutePath(application.getPath('feature.agents.transcripts'))
  const filePath = asAbsolutePath(path.join(directoryPath, `${hostSessionId}.json`))
  const store = new PortableAgentTranscriptStore(filePath, directoryPath)
  storeRefs.set(cacheKey, new WeakRef(store))
  return store
}
