import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { Mutex } from 'async-mutex'
import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { planLegacyMemory } from './legacyMemoryPlan'
import { findLegacyMemoryBackup } from './memoryBackups'
import {
  assertMemoryPath,
  assertMemoryTarget,
  MEMORY_ENTRY,
  MemoryError,
  memoryHash,
  readMemoryBytes
} from './memoryFiles'
import type { MemoryRead } from './MemoryStore'

const logger = loggerService.withContext('MemoryMigrationService')
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const stateSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(['pending', 'failed', 'complete']),
  sourceHash: hash.nullable(),
  files: z.array(z.strictObject({ path: z.string(), beforeHash: hash.nullable(), afterHash: hash })).max(2000),
  backupId: z.string().optional(),
  error: z.string().max(64).optional()
})
type MigrationState = z.infer<typeof stateSchema>

@Injectable('MemoryMigrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MemoryService'])
export class MemoryMigrationService extends BaseService {
  private readonly queue = new Mutex()
  private readonly work = createInFlightWorkTracker()
  private readonly pending = new Map<string, Promise<boolean>>()
  private readonly failed = new Set<string>()
  private stopped = false
  private generation = 0

  protected override onReady(): void {
    this.stopped = false
    this.failed.clear()
    this.registerDisposable(
      application.get('MemoryService').onChanged(({ scope, source }) => {
        if (scope.kind === 'private' && source === 'recovery') this.failed.delete(scope.agentId)
      })
    )
  }

  retryFromEditor(agentId: string): void {
    this.failed.delete(agentId)
  }

  isMigrated(agentId: string): boolean {
    return this.readState(agentId)?.status === 'complete'
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    const agentId = agentSessionService.getById(sessionId).agentId
    if (!agentId || !agentService.getAgent(agentId)) throw new Error('Agent memory owner is unavailable')
    const migrated = await application.get('MemoryService').prepareAgent(agentId)
    if (!agentService.getAgent(agentId)) throw new Error('Agent memory owner is unavailable')
    return migrated
  }

  ensureAgent(agentId: string): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    if (!agentService.getAgent(agentId)) return Promise.resolve(false)
    if (this.isMigrated(agentId)) return Promise.resolve(true)
    if (this.failed.has(agentId)) return Promise.resolve(false)
    const pending = this.pending.get(agentId)
    if (pending) return pending
    const generation = this.generation
    const operation = this.queue
      .runExclusive(() => this.migrate(agentId, generation))
      .catch((error) => {
        this.failed.add(agentId)
        logger.warn('Private migration is incomplete; legacy FACT is retained', { agentId, error })
        try {
          const previous = this.readState(agentId)
          if (previous && previous.status !== 'complete')
            this.writeState(agentId, {
              ...previous,
              status: 'failed',
              error: error instanceof MemoryError ? error.code : 'unavailable'
            })
        } catch (recordError) {
          logger.warn('Could not persist memory migration failure', { agentId, error: recordError })
        }
        return false
      })
      .finally(() => {
        this.pending.delete(agentId)
      })
    this.pending.set(agentId, operation)
    return this.work.track(operation)
  }

  protected async onStop(): Promise<void> {
    this.stopped = true
    this.generation++
    if (!(await this.work.drain())) throw new Error('Memory migration did not drain')
  }

  private async migrate(agentId: string, generation: number): Promise<boolean> {
    const assertCurrent = (): undefined => {
      if (this.stopped || generation !== this.generation || !agentService.getAgent(agentId))
        throw new Error('Memory migration owner is no longer active')
      return undefined
    }
    assertCurrent()
    const root = await ensureAgentDataDirectory(application.getPath('feature.agents.data'), agentId)
    const directory = await assertMemoryPath(root, 'memory')
    const names = await readdir(directory).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const facts = names.filter((name) => /^fact\.md$/i.test(name))
    if (facts.length > 1) throw new MemoryError('conflict', 'Multiple legacy FACT files require explicit resolution')
    const legacyPath = facts[0] ? `memory/${facts[0]}` : undefined
    const original = legacyPath ? await readMemoryBytes(root, legacyPath) : null
    const sourceHash = memoryHash(original)
    const session = application
      .get('MemoryService')
      .open({ scope: { kind: 'private', agentId }, assertAuthorized: assertCurrent }, 'migration')
    const assertSource = async () => {
      const currentNames = await readdir(await assertMemoryPath(root, 'memory')).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })
      if (currentNames.filter((name) => /^fact\.md$/i.test(name)).join('\0') !== facts.join('\0'))
        throw new MemoryError('conflict', 'The legacy FACT file set changed during migration')
      if (legacyPath && memoryHash(await readMemoryBytes(root, legacyPath)) !== sourceHash)
        throw new MemoryError('conflict', 'Legacy FACT changed during migration')
      assertCurrent()
    }
    try {
      const currentEntry = await session.read(MEMORY_ENTRY)
      const previous = this.readState(agentId)
      if (previous) {
        const actual = await Promise.all(previous.files.map((file) => session.read(file.path)))
        const allAfter = actual.every((file, index) => file.hash === previous.files[index].afterHash)
        const backupId =
          sourceHash === null
            ? undefined
            : await findLegacyMemoryBackup(
                path.join(application.getPath('feature.memory.backups'), 'agent', agentId),
                sourceHash
              )
        if (previous.sourceHash === sourceHash && allAfter && (sourceHash === null || backupId)) {
          await session.commit(
            [],
            async () => assertCurrent,
            actual.map((file) => file.receipt)
          )
          await assertSource()
          this.writeState(agentId, { ...previous, status: 'complete', backupId, error: undefined })
          return true
        }
        if (!actual.every((file, index) => file.hash === previous.files[index].beforeHash))
          throw new MemoryError(
            'conflict',
            'A partial legacy migration needs recovery before retrying; original FACT is retained'
          )
      }
      const content = original ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original) : ''
      const plan = await planLegacyMemory(content, currentEntry.content ?? '', sourceHash ?? 'empty')
      const reads = new Map<string, MemoryRead>([[MEMORY_ENTRY, currentEntry]])
      for (const [target, value] of plan) {
        const read = reads.get(target) ?? (await session.read(target))
        if (target !== MEMORY_ENTRY && read.content !== null && read.content !== value)
          throw new MemoryError('conflict', 'An existing topic conflicts with the legacy migration target')
        reads.set(target, read)
      }
      const state: MigrationState = {
        version: 1,
        status: 'pending',
        sourceHash,
        files: [...plan].map(([target, value]) => ({
          path: target,
          beforeHash: reads.get(target)!.hash,
          afterHash: memoryHash(Buffer.from(value))!
        }))
      }
      assertCurrent()
      this.writeState(agentId, state)
      const result = await session.commit(
        [...plan].map(([target, value]) => ({ kind: 'write', receipt: reads.get(target)!.receipt, content: value })),
        async () => assertCurrent,
        [...reads.values()].map((read) => read.receipt),
        original && legacyPath ? { path: legacyPath, content: original } : undefined
      )
      if (
        result.error !== undefined ||
        result.files.some((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged')
      )
        throw new MemoryError('conflict', 'Legacy migration did not finish; the new private scope remains inactive')
      for (const file of state.files)
        if ((await session.read(file.path)).hash !== file.afterHash)
          throw new MemoryError('conflict', 'Migrated memory changed before activation')
      await assertSource()
      this.writeState(agentId, { ...state, status: 'complete', backupId: result.batchId ?? undefined })
      return true
    } finally {
      session.dispose()
    }
  }

  private readState(agentId: string): MigrationState | undefined {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, `memory:migration:${agentId}`))
      .get()
    if (!row) return undefined
    const state = stateSchema.parse(row.value)
    for (const file of state.files) assertMemoryTarget(file.path)
    return state
  }

  private writeState(agentId: string, state: MigrationState): void {
    application
      .get('DbService')
      .getDb()
      .insert(appStateTable)
      .values({
        key: `memory:migration:${agentId}`,
        value: state,
        description: 'Private FACT migration metadata; no file bodies'
      })
      .onConflictDoUpdate({ target: appStateTable.key, set: { value: state } })
      .run()
  }
}
