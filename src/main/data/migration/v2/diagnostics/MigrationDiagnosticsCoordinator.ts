import { randomUUID } from 'node:crypto'

import type { MigrationPaths } from '@main/data/migration/v2/core/MigrationPaths'
import { app } from 'electron'

import { createMigrationDiagnosticRetentionPlan } from './migrationDiagnosticRetention'
import {
  cleanupMigrationDiagnosticsJournal,
  garbageCollectMigrationDiagnosticsQuarantines,
  MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES,
  MigrationDiagnosticsJournalWriteError,
  quarantineCorruptMigrationDiagnosticsJournal,
  readMigrationDiagnosticsJournal,
  writeMigrationDiagnosticsJournal
} from './migrationDiagnosticsJournal'
import {
  MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS,
  MIGRATION_DIAGNOSTICS_MAX_EVENTS,
  MIGRATION_DIAGNOSTICS_SESSION_VERSION,
  type MigrationAttemptTerminalOutcome,
  migrationAttemptTerminalOutcomeSchema,
  type MigrationAttemptTrigger,
  migrationAttemptTriggerSchema,
  type MigrationDiagnosticEventInput,
  migrationDiagnosticEventInputSchema,
  migrationDiagnosticEventSchema,
  type MigrationDiagnosticsArch,
  type MigrationDiagnosticsAttempt,
  migrationDiagnosticsAttemptSchema,
  type MigrationDiagnosticsPlatform,
  type MigrationDiagnosticsSession,
  migrationDiagnosticsSessionSchema
} from './migrationDiagnosticsSchemas'
import {
  migrationDiagnosticsV1SessionSchema,
  upgradeMigrationDiagnosticsV1Session
} from './migrationDiagnosticsV1Schemas'

export interface MigrationDiagnosticsCoordinatorOptions {
  readonly appVersion?: string
  readonly platform?: string
  readonly arch?: string
  readonly clock?: () => Date
  readonly idGenerator?: () => string
}

export interface MigrationDiagnosticsSaveInProgress {
  readonly status: 'failed'
  readonly code: 'save_in_progress'
}

type DeepReadonly<TValue> = TValue extends readonly (infer TItem)[]
  ? readonly DeepReadonly<TItem>[]
  : TValue extends object
    ? { readonly [TKey in keyof TValue]: DeepReadonly<TValue[TKey]> }
    : TValue

export type MigrationDiagnosticsSnapshot = DeepReadonly<MigrationDiagnosticsSession>

const SAVE_IN_PROGRESS_RESULT: MigrationDiagnosticsSaveInProgress = Object.freeze({
  status: 'failed',
  code: 'save_in_progress'
})

function normalizePlatform(platform: string): MigrationDiagnosticsPlatform {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'other'
}

function normalizeArch(arch: string): MigrationDiagnosticsArch {
  return arch === 'x64' || arch === 'arm64' || arch === 'ia32' ? arch : 'other'
}

function latestIsoTimestamp(...timestamps: Array<string | undefined>): string {
  const present = timestamps.filter((timestamp): timestamp is string => timestamp !== undefined)
  return present.reduce((latest, timestamp) => (Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest))
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function retainedSession(candidate: MigrationDiagnosticsSession): MigrationDiagnosticsSession {
  const newestAttempts = candidate.attempts.slice(-MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS)
  const retentionPlan = createMigrationDiagnosticRetentionPlan(newestAttempts)
  const totalEvents = newestAttempts.reduce((total, attempt) => total + attempt.events.length, 0)
  const eventLimitRemovalCount = Math.max(0, totalEvents - MIGRATION_DIAGNOSTICS_MAX_EVENTS)
  const removedSequences = new Set(retentionPlan.removableSequences.slice(0, eventLimitRemovalCount))
  let removalIndex = eventLimitRemovalCount
  let attempts = newestAttempts.map((attempt) => ({
    ...attempt,
    events: attempt.events.filter((event) => !removedSequences.has(event.sequence))
  })) as MigrationDiagnosticsAttempt[]

  let retained = { ...candidate, attempts } as MigrationDiagnosticsSession
  while (Buffer.byteLength(JSON.stringify(retained), 'utf8') > MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES) {
    const removable = retentionPlan.removableSequences[removalIndex]
    if (removable === undefined) {
      throw new Error('Migration diagnostics journal cannot satisfy its fixed size limit')
    }
    removalIndex += 1
    attempts = attempts.map((attempt) => ({
      ...attempt,
      events: attempt.events.filter((event) => event.sequence !== removable)
    })) as MigrationDiagnosticsAttempt[]
    retained = { ...candidate, attempts } as MigrationDiagnosticsSession
  }

  return migrationDiagnosticsSessionSchema.parse(retained)
}

export class MigrationDiagnosticsCoordinator {
  private readonly clock: () => Date
  private readonly idGenerator: () => string
  private currentSession: MigrationDiagnosticsSession
  private attachedPaths: MigrationPaths | null = null
  private hasAttached = false
  private wasRecovered = false
  private snapshotPromise: Promise<MigrationDiagnosticsSnapshot> | null = null
  private saveInProgress = false

  constructor(options: MigrationDiagnosticsCoordinatorOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.idGenerator = options.idGenerator ?? randomUUID
    this.currentSession = migrationDiagnosticsSessionSchema.parse({
      version: MIGRATION_DIAGNOSTICS_SESSION_VERSION,
      sessionId: this.idGenerator(),
      appVersion: options.appVersion ?? app.getVersion(),
      platform: normalizePlatform(options.platform ?? process.platform),
      arch: normalizeArch(options.arch ?? process.arch),
      startedAt: this.nowIso(),
      state: 'active',
      attempts: []
    })
  }

  get recovered(): boolean {
    return this.wasRecovered
  }

  attachPaths(paths: MigrationPaths): void {
    if (this.hasAttached) {
      throw new Error('Migration diagnostics paths are already attached')
    }
    this.hasAttached = true
    this.attachedPaths = paths

    const now = this.clock()
    garbageCollectMigrationDiagnosticsQuarantines(paths.diagnosticsJournalFile, { now })
    const existing = readMigrationDiagnosticsJournal(paths.diagnosticsJournalFile)

    if (existing.kind === 'none') {
      this.attachLegacyOrFresh(paths, now)
      return
    }

    if (existing.kind === 'corrupt') {
      quarantineCorruptMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, { now })
      writeMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, this.currentSession)
      return
    }

    this.adoptExistingSession(paths, existing.journal)
  }

  private attachLegacyOrFresh(paths: MigrationPaths, now: Date): void {
    garbageCollectMigrationDiagnosticsQuarantines(paths.legacyDiagnosticsJournalFile, { now })
    const legacy = readMigrationDiagnosticsJournal(
      paths.legacyDiagnosticsJournalFile,
      migrationDiagnosticsV1SessionSchema
    )

    if (legacy.kind === 'none') {
      writeMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, this.currentSession)
      return
    }

    if (legacy.kind === 'corrupt') {
      quarantineCorruptMigrationDiagnosticsJournal(paths.legacyDiagnosticsJournalFile, { now })
      writeMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, this.currentSession)
      return
    }

    const upgraded = upgradeMigrationDiagnosticsV1Session(legacy.journal)
    writeMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, upgraded)
    cleanupMigrationDiagnosticsJournal(paths.legacyDiagnosticsJournalFile)
    this.adoptExistingSession(paths, upgraded)
  }

  private adoptExistingSession(paths: MigrationPaths, existing: MigrationDiagnosticsSession): void {
    if (existing.state === 'completed') {
      cleanupMigrationDiagnosticsJournal(paths.diagnosticsJournalFile)
      writeMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, this.currentSession)
      return
    }

    this.wasRecovered = true
    this.currentSession = existing
    this.closeRecoveredAttempt()
  }

  beginAttempt(trigger: MigrationAttemptTrigger): string {
    const validatedTrigger = migrationAttemptTriggerSchema.parse(trigger)
    if (this.activeAttemptIndex() !== -1) {
      throw new Error('Migration diagnostics already has an active attempt')
    }

    const attempt = migrationDiagnosticsAttemptSchema.parse({
      id: this.idGenerator(),
      trigger: validatedTrigger,
      startedAt: this.nowIso(),
      outcome: 'in_progress',
      events: []
    })
    this.commit({
      ...this.currentSession,
      state: 'active',
      attempts: [...this.currentSession.attempts, attempt]
    })
    return attempt.id
  }

  recordEvent(input: MigrationDiagnosticEventInput): void {
    const validatedInput = migrationDiagnosticEventInputSchema.parse(input)
    const attemptIndex = this.requireActiveAttemptIndex()
    const attempt = this.currentSession.attempts[attemptIndex]
    const at = latestIsoTimestamp(this.nowIso(), attempt.startedAt, attempt.events.at(-1)?.at)
    const event = migrationDiagnosticEventSchema.parse({
      ...validatedInput,
      sequence: this.nextSequence(),
      at,
      attemptId: attempt.id
    })
    const attempts = [...this.currentSession.attempts]
    attempts[attemptIndex] = { ...attempt, events: [...attempt.events, event] }
    this.commit({ ...this.currentSession, attempts })
  }

  finishAttempt(outcome: MigrationAttemptTerminalOutcome, terminalInput: MigrationDiagnosticEventInput): void {
    const validatedOutcome = migrationAttemptTerminalOutcomeSchema.parse(outcome)
    const validatedInput = migrationDiagnosticEventInputSchema.parse(terminalInput)
    if (validatedInput.state !== validatedOutcome) {
      throw new Error('Migration diagnostics terminal event state must match its attempt outcome')
    }

    const attemptIndex = this.requireActiveAttemptIndex()
    const attempt = this.currentSession.attempts[attemptIndex]
    const at = latestIsoTimestamp(this.nowIso(), attempt.startedAt, attempt.events.at(-1)?.at)
    const terminalEvent = migrationDiagnosticEventSchema.parse({
      ...validatedInput,
      sequence: this.nextSequence(),
      at,
      attemptId: attempt.id
    })
    const attempts = [...this.currentSession.attempts]
    attempts[attemptIndex] = {
      ...attempt,
      outcome: validatedOutcome,
      endedAt: at,
      events: [...attempt.events, terminalEvent]
    }
    this.commit({
      ...this.currentSession,
      state: validatedOutcome === 'completed' ? 'active' : 'failed',
      attempts
    })
  }

  complete(): void {
    if (this.activeAttemptIndex() !== -1) {
      throw new Error('Migration diagnostics cannot complete with an active attempt')
    }
    this.currentSession = migrationDiagnosticsSessionSchema.parse({ ...this.currentSession, state: 'completed' })
    if (this.attachedPaths !== null) {
      cleanupMigrationDiagnosticsJournal(this.attachedPaths.diagnosticsJournalFile)
    }
  }

  snapshot(): Promise<MigrationDiagnosticsSnapshot> {
    if (this.snapshotPromise !== null) {
      return this.snapshotPromise
    }

    const snapshot = deepFreeze(migrationDiagnosticsSessionSchema.parse(this.currentSession))
    const promise = Promise.resolve(snapshot)
    this.snapshotPromise = promise
    void promise.then(
      () => {
        if (this.snapshotPromise === promise) {
          this.snapshotPromise = null
        }
      },
      () => {
        if (this.snapshotPromise === promise) {
          this.snapshotPromise = null
        }
      }
    )
    return promise
  }

  async runSave<TResult>(
    operation: (snapshot: MigrationDiagnosticsSnapshot) => Promise<TResult>
  ): Promise<TResult | MigrationDiagnosticsSaveInProgress> {
    if (this.saveInProgress) {
      return SAVE_IN_PROGRESS_RESULT
    }

    this.saveInProgress = true
    try {
      return await operation(await this.snapshot())
    } finally {
      this.saveInProgress = false
    }
  }

  private nowIso(): string {
    return this.clock().toISOString()
  }

  private activeAttemptIndex(): number {
    return this.currentSession.attempts.findLastIndex((attempt) => attempt.outcome === 'in_progress')
  }

  private requireActiveAttemptIndex(): number {
    const index = this.activeAttemptIndex()
    if (index === -1) {
      throw new Error('Migration diagnostics requires an active attempt')
    }
    return index
  }

  private nextSequence(): number {
    let sequence = 0
    for (const attempt of this.currentSession.attempts) {
      for (const event of attempt.events) {
        sequence = Math.max(sequence, event.sequence)
      }
    }
    return sequence + 1
  }

  private closeRecoveredAttempt(): void {
    const attemptIndex = this.activeAttemptIndex()
    if (attemptIndex === -1) {
      return
    }

    const attempt = this.currentSession.attempts[attemptIndex]
    const at = latestIsoTimestamp(attempt.startedAt, attempt.events.at(-1)?.at)
    const terminalEvent = migrationDiagnosticEventSchema.parse({
      sequence: this.nextSequence(),
      at,
      attemptId: attempt.id,
      scope: 'gate',
      phase: 'finalize',
      state: 'interrupted',
      code: 'unknown'
    })
    const attempts = [...this.currentSession.attempts]
    attempts[attemptIndex] = {
      ...attempt,
      outcome: 'interrupted',
      endedAt: at,
      events: [...attempt.events, terminalEvent]
    }
    this.commit({ ...this.currentSession, state: 'failed', attempts })
  }

  private commit(candidate: MigrationDiagnosticsSession): void {
    const retained = retainedSession(candidate)
    if (this.attachedPaths !== null) {
      try {
        writeMigrationDiagnosticsJournal(this.attachedPaths.diagnosticsJournalFile, retained)
      } catch (error) {
        if (error instanceof MigrationDiagnosticsJournalWriteError && error.publication === 'published') {
          this.currentSession = retained
        }
        throw error
      }
    }
    this.currentSession = retained
  }
}
