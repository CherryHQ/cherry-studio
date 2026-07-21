import { loggerService } from '@logger'
import type { MigrationPaths } from '@main/data/migration/v2/core/MigrationPaths'
import { app } from 'electron'
import semver from 'semver'

import {
  cleanupMigrationDiagnosticsJournal,
  readMigrationDiagnosticsJournal,
  writeMigrationDiagnosticsJournal
} from './migrationDiagnosticsJournal'
import {
  type MigrationAttemptFinish,
  type MigrationAttemptTrigger,
  type MigrationDiagnosticAttempt,
  type MigrationDiagnosticLocation,
  migrationDiagnosticLocationSchema,
  type MigrationDiagnosticsArch,
  migrationDiagnosticsCheckpointSchema,
  type MigrationDiagnosticsPlatform,
  type MigrationDiagnosticsSnapshot
} from './migrationDiagnosticsSchemas'

const logger = loggerService.withContext('MigrationDiagnosticsCoordinator')

interface MigrationDiagnosticsCoordinatorOptions {
  readonly appVersion?: string
  readonly platform?: string
  readonly arch?: string
  readonly clock?: () => Date
}

export type { MigrationDiagnosticsSnapshot }

function normalizeVersion(version: string): string {
  if (version.length > 128) return 'unknown'
  return semver.valid(version) ?? 'unknown'
}

function normalizePlatform(platform: string): MigrationDiagnosticsPlatform {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'other'
}

function normalizeArch(arch: string): MigrationDiagnosticsArch {
  return arch === 'x64' || arch === 'arm64' || arch === 'ia32' ? arch : 'other'
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

export class MigrationDiagnosticsCoordinator {
  private readonly clock: () => Date
  private currentCheckpoint: MigrationDiagnosticsSnapshot
  private attachedPaths: Pick<MigrationPaths, 'diagnosticsJournalFile'> | null = null
  private hasAttached = false
  private wasRecovered = false

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

    const existing = readMigrationDiagnosticsJournal(paths.diagnosticsJournalFile)
    if (existing.kind === 'none') return
    if (existing.kind === 'corrupt') {
      try {
        cleanupMigrationDiagnosticsJournal(paths.diagnosticsJournalFile)
      } catch {
        logger.warn('Failed to remove invalid migration diagnostics checkpoint')
      }
      return
    }

    if (existing.journal.state === 'completed') {
      this.cleanupBestEffort()
      return
    }

    this.currentCheckpoint = existing.journal
    if (existing.journal.current?.status === 'in_progress') {
      this.closeRecoveredAttempt()
      this.wasRecovered = true
    } else {
      this.wasRecovered = existing.journal.current?.status === 'interrupted'
    }
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

  finishAttempt(result: MigrationAttemptFinish): void {
    const current = this.requireActiveAttempt()
    const endedAt = this.nowIsoAtOrAfter(current.startedAt)

    if (result.status === 'completed') {
      this.commit({
        ...this.currentCheckpoint,
        state: 'completed',
        current: {
          ...current,
          status: 'completed',
          endedAt
        }
      })
      return
    }

    if (result.status === 'failed') {
      this.commit({
        ...this.currentCheckpoint,
        state: 'failed',
        current: {
          ...current,
          status: 'failed',
          endedAt,
          failure: result.failure
        }
      })
      return
    }

    this.commit({
      ...this.currentCheckpoint,
      state: 'failed',
      current: {
        ...current,
        status: 'interrupted',
        endedAt,
        failure: result.failure
      }
    })
  }

  complete(): void {
    if (this.currentCheckpoint.current?.status === 'in_progress') {
      throw new Error('Migration diagnostics cannot complete with an active attempt')
    }
    this.cleanupBestEffort()
  }

  snapshot(): Promise<MigrationDiagnosticsSnapshot> {
    const snapshot = deepFreeze(migrationDiagnosticsCheckpointSchema.parse(this.currentCheckpoint))
    return Promise.resolve(snapshot)
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
      errorCode: 'process_interrupted'
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
