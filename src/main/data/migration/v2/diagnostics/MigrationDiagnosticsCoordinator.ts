import { loggerService } from '@logger'
import type { MigrationPaths } from '@main/data/migration/v2/core/MigrationPaths'
import { app } from 'electron'

import {
  cleanupMigrationDiagnosticsJournal,
  garbageCollectMigrationDiagnosticsQuarantines,
  quarantineCorruptMigrationDiagnosticsJournal,
  readMigrationDiagnosticsJournal,
  writeMigrationDiagnosticsJournal
} from './migrationDiagnosticsJournal'
import {
  type MigrationAttemptFinish,
  type MigrationAttemptTerminalOutcome,
  type MigrationAttemptTrigger,
  type MigrationDiagnosticAttempt,
  type MigrationDiagnosticEventInput,
  type MigrationDiagnosticFailure,
  type MigrationDiagnosticLocation,
  migrationDiagnosticLocationSchema,
  type MigrationDiagnosticsArch,
  migrationDiagnosticsCheckpointSchema,
  type MigrationDiagnosticsPlatform,
  type MigrationDiagnosticsSnapshot
} from './migrationDiagnosticsSchemas'

const logger = loggerService.withContext('MigrationDiagnosticsCoordinator')

export interface MigrationDiagnosticsCoordinatorOptions {
  readonly appVersion?: string
  readonly platform?: string
  readonly arch?: string
  readonly clock?: () => Date
}

export interface MigrationDiagnosticsSaveInProgress {
  readonly status: 'failed'
  readonly code: 'save_in_progress'
}

export type { MigrationDiagnosticsSnapshot }

const SAVE_IN_PROGRESS_RESULT: MigrationDiagnosticsSaveInProgress = Object.freeze({
  status: 'failed',
  code: 'save_in_progress'
})

function normalizeVersion(version: string): string {
  const match = /^(\d{1,6}\.\d{1,6}\.\d{1,6})(?:[-+].*)?$/.exec(version)
  return match?.[1] ?? 'unknown'
}

function normalizePlatform(platform: string): MigrationDiagnosticsPlatform {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'other'
}

function normalizeArch(arch: string): MigrationDiagnosticsArch {
  return arch === 'x64' || arch === 'arm64' || arch === 'ia32' ? arch : 'other'
}

function warningCountBucket(warningCount: number): '0' | '1' | '2-10' | '11+' {
  if (!Number.isSafeInteger(warningCount) || warningCount < 0) {
    throw new Error('Migration warning count must be a non-negative safe integer')
  }
  if (warningCount === 0) return '0'
  if (warningCount === 1) return '1'
  if (warningCount <= 10) return '2-10'
  return '11+'
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function legacyErrorCode(code: MigrationDiagnosticEventInput['code']): MigrationDiagnosticFailure['errorCode'] {
  switch (code) {
    case 'path_unavailable':
      return 'file_missing'
    case 'permission_denied':
      return 'file_permission'
    case 'disk_full':
      return 'file_io'
    case 'sqlite_corrupt':
    case 'sqlite_not_database':
    case 'sqlite_too_big':
    case 'sqlite_constraint':
    case 'sqlite_schema':
      return code
    default:
      return 'unknown_error'
  }
}

export class MigrationDiagnosticsCoordinator {
  private readonly clock: () => Date
  private currentCheckpoint: MigrationDiagnosticsSnapshot
  private attachedPaths: Pick<MigrationPaths, 'diagnosticsJournalFile'> | null = null
  private hasAttached = false
  private wasRecovered = false
  private snapshotPromise: Promise<MigrationDiagnosticsSnapshot> | null = null
  private saveInProgress = false

  constructor(options: MigrationDiagnosticsCoordinatorOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.currentCheckpoint = migrationDiagnosticsCheckpointSchema.parse({
      formatVersion: 1,
      app: {
        version: normalizeVersion(options.appVersion ?? app.getVersion()),
        platform: normalizePlatform(options.platform ?? process.platform),
        arch: normalizeArch(options.arch ?? process.arch)
      },
      state: 'active'
    })
  }

  get recovered(): boolean {
    return this.wasRecovered
  }

  attachPaths(paths: Pick<MigrationPaths, 'diagnosticsJournalFile'>): void {
    if (this.hasAttached) throw new Error('Migration diagnostics paths are already attached')
    this.hasAttached = true
    this.attachedPaths = paths

    const now = this.clock()
    try {
      garbageCollectMigrationDiagnosticsQuarantines(paths.diagnosticsJournalFile, { now })
    } catch {
      logger.warn('Failed to clean migration diagnostics quarantines')
    }

    const existing = readMigrationDiagnosticsJournal(paths.diagnosticsJournalFile)
    if (existing.kind === 'none') {
      this.persistBestEffort()
      return
    }
    if (existing.kind === 'corrupt') {
      try {
        quarantineCorruptMigrationDiagnosticsJournal(paths.diagnosticsJournalFile, { now })
      } catch {
        logger.warn('Failed to quarantine invalid migration diagnostics checkpoint')
      }
      this.persistBestEffort()
      return
    }

    if (existing.journal.state === 'completed') {
      this.cleanupBestEffort()
      this.persistBestEffort()
      return
    }

    this.currentCheckpoint = existing.journal
    this.wasRecovered = existing.journal.current !== undefined
    if (existing.journal.current?.status === 'in_progress') this.closeRecoveredAttempt()
  }

  beginAttempt(trigger: MigrationAttemptTrigger): void {
    if (this.currentCheckpoint.current?.status === 'in_progress') {
      throw new Error('Migration diagnostics already has an active attempt')
    }

    const previous =
      this.currentCheckpoint.current?.status === 'failed' || this.currentCheckpoint.current?.status === 'interrupted'
        ? this.currentCheckpoint.current
        : this.currentCheckpoint.previous
    this.commit({
      ...this.currentCheckpoint,
      state: 'active',
      ...(previous === undefined ? {} : { previous }),
      current: {
        trigger,
        status: 'in_progress',
        startedAt: this.nowIso(),
        lastLocation: { scope: 'gate', phase: 'resolve_paths' }
      }
    })
  }

  updateLocation(location: MigrationDiagnosticLocation): void {
    const current = this.requireActiveAttempt()
    const validated = migrationDiagnosticLocationSchema.parse(location)
    this.commit({
      ...this.currentCheckpoint,
      current: { ...current, lastLocation: validated }
    })
  }

  finishAttempt(result: MigrationAttemptFinish): void
  /** @deprecated Temporary adapter for event-based gate/engine callers while they migrate to failures. */
  finishAttempt(outcome: MigrationAttemptTerminalOutcome, terminalInput: MigrationDiagnosticEventInput): void
  finishAttempt(
    resultOrOutcome: MigrationAttemptFinish | MigrationAttemptTerminalOutcome,
    terminalInput?: MigrationDiagnosticEventInput
  ): void {
    const result =
      typeof resultOrOutcome === 'string'
        ? this.fromLegacyFinish(resultOrOutcome, terminalInput as MigrationDiagnosticEventInput)
        : resultOrOutcome
    const current = this.requireActiveAttempt()
    const endedAt = this.nowIsoAtOrAfter(current.startedAt)

    if (result.status === 'completed') {
      this.commit({
        ...this.currentCheckpoint,
        state: 'completed',
        current: {
          ...current,
          status: 'completed',
          endedAt,
          warningCountBucket: warningCountBucket(result.warningCount)
        }
      })
      return
    }

    this.commit({
      ...this.currentCheckpoint,
      state: 'failed',
      current: {
        ...current,
        status: result.status,
        endedAt,
        failure: result.failure
      }
    })
  }

  /** @deprecated Temporary adapter; non-terminal events now update only the last known location. */
  recordEvent(input: MigrationDiagnosticEventInput): void {
    const scope = input.scope === 'bundle' ? 'engine' : input.scope
    const phase = input.phase === 'save' ? 'finalize' : input.phase
    this.updateLocation({ scope, phase, ...(input.migratorId === undefined ? {} : { migratorId: input.migratorId }) })
  }

  complete(): void {
    if (this.currentCheckpoint.current?.status === 'in_progress') {
      throw new Error('Migration diagnostics cannot complete with an active attempt')
    }
    this.cleanupBestEffort()
  }

  snapshot(): Promise<MigrationDiagnosticsSnapshot> {
    if (this.snapshotPromise !== null) return this.snapshotPromise

    const snapshot = deepFreeze(migrationDiagnosticsCheckpointSchema.parse(this.currentCheckpoint))
    const promise = Promise.resolve(snapshot)
    this.snapshotPromise = promise
    void promise.finally(() => {
      if (this.snapshotPromise === promise) this.snapshotPromise = null
    })
    return promise
  }

  async runSave<TResult>(
    save: (snapshot: MigrationDiagnosticsSnapshot) => Promise<TResult>
  ): Promise<TResult | MigrationDiagnosticsSaveInProgress> {
    if (this.saveInProgress) return SAVE_IN_PROGRESS_RESULT

    this.saveInProgress = true
    try {
      return await save(await this.snapshot())
    } finally {
      this.saveInProgress = false
    }
  }

  private nowIso(): string {
    return this.clock().toISOString()
  }

  private nowIsoAtOrAfter(startedAt: string): string {
    const now = this.nowIso()
    return Date.parse(now) >= Date.parse(startedAt) ? now : startedAt
  }

  private requireActiveAttempt(): Extract<MigrationDiagnosticAttempt, { status: 'in_progress' }> {
    const current = this.currentCheckpoint.current
    if (current?.status !== 'in_progress') throw new Error('Migration diagnostics requires an active attempt')
    return current
  }

  private closeRecoveredAttempt(): void {
    const current = this.requireActiveAttempt()
    const failure = {
      kind: 'process_interrupted',
      scope: 'engine',
      phase: 'interrupted',
      errorCode: 'process_interrupted',
      evidence: {
        kind: 'interruption',
        lastLocation: current.lastLocation,
        recoverySource: 'checkpoint'
      }
    } as const
    this.commit({
      ...this.currentCheckpoint,
      state: 'failed',
      current: {
        ...current,
        status: 'interrupted',
        endedAt: this.nowIsoAtOrAfter(current.startedAt),
        failure
      }
    })
  }

  private fromLegacyFinish(
    outcome: MigrationAttemptTerminalOutcome,
    input: MigrationDiagnosticEventInput
  ): MigrationAttemptFinish {
    if (outcome === 'completed') return { status: 'completed', warningCount: 0 }
    const current = this.requireActiveAttempt()
    if (outcome === 'interrupted') {
      return {
        status: 'interrupted',
        failure: {
          kind: 'process_interrupted',
          scope: 'engine',
          phase: 'interrupted',
          errorCode: input.code === 'renderer_process_gone' ? 'renderer_process_gone' : 'process_interrupted',
          evidence: {
            kind: 'interruption',
            lastLocation: current.lastLocation,
            recoverySource: 'live_renderer_event'
          }
        }
      }
    }
    if (input.scope === 'gate') {
      if (input.code === 'upgrade_path_blocked' && input.versionGate !== undefined) {
        return {
          status: 'failed',
          failure: {
            kind: 'upgrade_path_blocked',
            scope: 'gate',
            phase: 'validate',
            errorCode: input.versionGate.reason,
            evidence: { kind: 'version_gate', context: input.versionGate }
          }
        }
      }
      return {
        status: 'failed',
        failure: {
          kind: 'preboot_failed',
          scope: 'gate',
          phase: 'finalize',
          errorCode: 'unknown_error'
        }
      }
    }
    if (input.scope === 'renderer_export') {
      const semantic = input.semanticEvidence?.kind === 'renderer_export_failure' ? input.semanticEvidence : undefined
      return {
        status: 'failed',
        failure: {
          kind: 'renderer_export_failed',
          scope: 'renderer_export',
          phase: 'finalize',
          errorCode: input.code === 'source_parse' ? 'source_parse_failed' : 'unknown_error',
          evidence: {
            kind: 'renderer_export',
            sourceRole: semantic?.sourceRole ?? 'unknown',
            operationRole: semantic?.operationRole ?? 'unknown'
          }
        }
      }
    }
    return {
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'database',
        phase: 'execute',
        errorCode: legacyErrorCode(input.code)
      }
    }
  }

  private commit(candidate: MigrationDiagnosticsSnapshot): void {
    this.currentCheckpoint = migrationDiagnosticsCheckpointSchema.parse(candidate)
    this.persistBestEffort()
  }

  private persistBestEffort(): void {
    if (this.attachedPaths === null) return
    try {
      writeMigrationDiagnosticsJournal(this.attachedPaths.diagnosticsJournalFile, this.currentCheckpoint)
    } catch {
      logger.warn('Failed to persist migration diagnostics checkpoint')
    }
  }

  private cleanupBestEffort(): void {
    if (this.attachedPaths === null) return
    try {
      cleanupMigrationDiagnosticsJournal(this.attachedPaths.diagnosticsJournalFile)
    } catch {
      logger.warn('Failed to clean migration diagnostics checkpoint')
    }
  }
}
