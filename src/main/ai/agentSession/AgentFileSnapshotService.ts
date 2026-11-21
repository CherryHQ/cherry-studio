import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { listEntries, reclaimStale } from '@main/ai/runtime/orphanSessionReclaim'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AgentFileSnapshotReason } from '@shared/ipc/schemas/agentFileSnapshot'
import { KeyedMutex } from '@shared/utils/async'

import {
  atomicWrite,
  inspectFile,
  MAX_SNAPSHOT_BYTES,
  parentIdentity,
  resolveExistingPath,
  safeSegment,
  type Manifest
} from './agentFileSnapshot'
import type { SnapshotFile } from './agentFileSnapshot'
import { candidateBytesFor, classifyDestructiveWrite } from './destructiveFileWrite'

const logger = loggerService.withContext('AgentFileSnapshotService')
type AttemptClassification = ReturnType<typeof classifyDestructiveWrite>
type AttestRound = () => string | null

async function currentFileState(file: SnapshotFile, maxFileBytes: number): Promise<'baseline' | 'after' | 'conflict'> {
  try {
    const state = (await inspectFile(file.path, maxFileBytes)).state
    if (
      state.exists === file.existedBefore &&
      state.size === file.sizeBefore &&
      state.sha256 === file.sha256Before &&
      state.mode === file.modeBefore
    )
      return 'baseline'
    if (
      state.exists &&
      state.size === file.afterSize &&
      state.sha256 === file.afterHash &&
      state.mode === (file.afterMode ?? file.modeBefore) &&
      JSON.stringify(await parentIdentity(file.path, file.parent.anchorPath)) === JSON.stringify(file.parent)
    )
      return 'after'
  } catch {
    return 'conflict'
  }
  return 'conflict'
}

async function pendingMatchesBaseline(file: SnapshotFile, maxFileBytes: number): Promise<boolean> {
  try {
    const state = (await inspectFile(file.path, maxFileBytes)).state
    return (
      JSON.stringify(await parentIdentity(file.path, file.parent.anchorPath)) === JSON.stringify(file.parent) &&
      state.exists === file.existedBefore &&
      state.size === file.sizeBefore &&
      state.sha256 === file.sha256Before &&
      state.mode === file.modeBefore
    )
  } catch {
    return false
  }
}

function isInputPrefix(prefix: readonly string[], inputIds: readonly string[]): boolean {
  return prefix.length <= inputIds.length && prefix.every((id, index) => id === inputIds[index])
}

export type SnapshotRound = { sessionId: string; replyId: string; inputMessageIds: readonly string[] }
export type ProtectedFileCall = {
  round: SnapshotRound
  callId: string
  runtime: 'claude-code' | 'pi' | 'pi-durable'
  toolName: string
  origin?: 'subagent'
  filePath: string
  cwd: string
  intent: { toolName: string; input: Record<string, unknown> }
}
export type UndoFileResult = {
  path: string
  status: 'restored' | 'removed' | 'already-restored' | 'conflict' | 'failed' | 'unknown' | 'skipped' | 'unverifiable'
  reason?: 'unverifiable'
}

@Injectable('AgentFileSnapshotService')
@ServicePhase(Phase.WhenReady)
export class AgentFileSnapshotService extends BaseService {
  constructor(private readonly options: { maxFileBytes?: number } = {}) {
    super()
  }

  private get maxFileBytes(): number {
    return this.options.maxFileBytes ?? MAX_SNAPSHOT_BYTES
  }

  private readonly locks = new KeyedMutex()
  private readonly busy = new Map<string, number>()
  private readonly currentRounds = new Map<
    string,
    {
      manifest: Manifest
      persisted: boolean
      resumed?: boolean
      failed?: boolean
      finishPromise?: Promise<void>
    } | null
  >()
  private async exclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    this.busy.set(id, (this.busy.get(id) ?? 0) + 1)
    try {
      return await this.locks.runExclusive(id, task)
    } finally {
      const remaining = this.busy.get(id)! - 1
      if (remaining) this.busy.set(id, remaining)
      else this.busy.delete(id)
    }
  }
  async workspaceRoots(): Promise<string[]> {
    return agentWorkspaceService.list({ includeSystem: true }).map((workspace) => workspace.path)
  }
  private root(): string {
    return application.getPath('feature.agents.file_snapshots')
  }
  private session(id: string): string {
    return path.join(this.root(), safeSegment(id))
  }
  private roundDir(round: SnapshotRound): string {
    return path.join(this.session(round.sessionId), safeSegment(round.replyId))
  }
  private async read(round: SnapshotRound): Promise<Manifest> {
    const current = this.currentRounds.get(round.sessionId)
    if (current && !current.persisted && current.manifest.replyId === round.replyId) return current.manifest
    return JSON.parse(await fs.readFile(path.join(this.roundDir(round), 'manifest.json'), 'utf8')) as Manifest
  }
  private async save(manifest: Manifest): Promise<void> {
    manifest.revision = String(BigInt(manifest.revision) + 1n)
    await atomicWrite(path.join(this.roundDir(manifest), 'manifest.json'), JSON.stringify(manifest))
  }
  async admitRound(round: SnapshotRound): Promise<void> {
    await this.exclusive(round.sessionId, async () => {
      try {
        safeSegment(round.sessionId)
        safeSegment(round.replyId)
        const current = this.currentRounds.get(round.sessionId)
        if (current?.manifest.replyId === round.replyId) {
          if (JSON.stringify(current.manifest.inputMessageIds) !== JSON.stringify(round.inputMessageIds))
            throw new Error('Round ownership mismatch')
          return
        }
        this.currentRounds.set(round.sessionId, {
          manifest: {
            formatVersion: 1,
            sessionId: round.sessionId,
            replyId: round.replyId,
            inputMessageIds: [...round.inputMessageIds],
            revision: '0',
            savedAt: new Date().toISOString(),
            files: []
          },
          persisted: false
        })
      } catch (error) {
        this.currentRounds.set(round.sessionId, null)
        throw error
      }
    })
  }
  async resumeRound(round: SnapshotRound): Promise<void> {
    await this.exclusive(round.sessionId, async () => {
      try {
        const current = this.currentRounds.get(round.sessionId)
        let manifest: Manifest
        try {
          manifest = JSON.parse(await fs.readFile(path.join(this.roundDir(round), 'manifest.json'), 'utf8')) as Manifest
          if (manifest.sessionId !== round.sessionId || manifest.replyId !== round.replyId)
            throw new Error('Round ownership mismatch')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          manifest =
            current?.manifest.replyId === round.replyId
              ? current.manifest
              : {
                  formatVersion: 1,
                  sessionId: round.sessionId,
                  replyId: round.replyId,
                  inputMessageIds: [...round.inputMessageIds],
                  revision: '0',
                  savedAt: new Date().toISOString(),
                  files: []
                }
        }
        delete manifest.finishedAt
        this.currentRounds.set(round.sessionId, { manifest, persisted: false, resumed: true })
      } catch (error) {
        this.currentRounds.set(round.sessionId, null)
        throw error
      }
    })
  }
  async extendRoundInputs(round: SnapshotRound): Promise<void> {
    await this.exclusive(round.sessionId, async () => {
      const current = this.currentRounds.get(round.sessionId)
      if (current?.manifest.replyId === round.replyId && current.manifest.finishedAt) return
      if (
        !current ||
        current.manifest.replyId !== round.replyId ||
        !isInputPrefix(current.manifest.inputMessageIds, round.inputMessageIds)
      )
        throw new Error('Round ownership mismatch')
      if (current.manifest.inputMessageIds.length !== round.inputMessageIds.length) {
        const manifest = current.persisted ? await this.read(round) : current.manifest
        if (!isInputPrefix(manifest.inputMessageIds, round.inputMessageIds)) throw new Error('Round ownership mismatch')
        manifest.inputMessageIds = [...round.inputMessageIds]
        if (current.persisted) await this.save(manifest)
        current.manifest = manifest
      }
    })
  }
  async protectWrite(
    call: ProtectedFileCall
  ): Promise<
    | { attemptId: string; classification: AttemptClassification }
    | { reason: 'no-round'; attemptId?: never; classification?: never }
  > {
    return this.exclusive(call.round.sessionId, async () => {
      const current = this.currentRounds.get(call.round.sessionId)
      if (!current || current.manifest.finishedAt) return { reason: 'no-round' as const }
      if (current.manifest.replyId !== call.round.replyId) throw new Error('Round is not current')
      if (!path.isAbsolute(call.filePath)) throw new Error('Snapshot target must be absolute')
      if (
        !current.resumed &&
        JSON.stringify(current.manifest.inputMessageIds) !== JSON.stringify(call.round.inputMessageIds)
      )
        throw new Error('Round ownership mismatch')
      const roots = await this.workspaceRoots()
      const workspaces = await Promise.all(
        [...roots, call.cwd].map((workspace) => resolveExistingPath(path.resolve(workspace)))
      )
      const root = await resolveExistingPath(path.resolve(this.root()))
      for (const workspace of workspaces) {
        const relative = path.relative(workspace, root)
        if (
          relative === '' ||
          (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        )
          throw Object.assign(new Error('Snapshot root is inside the workspace'), {
            code: 'SNAPSHOT_ROOT_IN_WORKSPACE'
          })
      }
      if (!current.persisted) {
        try {
          let existing: Manifest | undefined
          try {
            existing = JSON.parse(
              await fs.readFile(path.join(this.roundDir(call.round), 'manifest.json'), 'utf8')
            ) as Manifest
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          if (
            existing &&
            (existing.sessionId !== call.round.sessionId ||
              existing.replyId !== call.round.replyId ||
              (!current.resumed &&
                JSON.stringify(existing.inputMessageIds) !== JSON.stringify(call.round.inputMessageIds)))
          )
            throw new Error('Round ownership mismatch')
          for (const dir of [
            this.root(),
            this.session(call.round.sessionId),
            this.roundDir(call.round),
            path.join(this.roundDir(call.round), 'blobs')
          ]) {
            await fs.mkdir(dir, { recursive: true, mode: 0o700 })
            await fs.chmod(dir, 0o700).catch(() => {})
          }
          if (existing) {
            if (current.resumed && existing.finishedAt) {
              delete existing.finishedAt
              await this.save(existing)
            }
            current.manifest = existing
          } else await this.save(current.manifest)
          await atomicWrite(
            path.join(this.session(call.round.sessionId), 'current.json'),
            JSON.stringify({ replyId: call.round.replyId })
          )
          current.persisted = true
        } catch (error) {
          this.currentRounds.set(call.round.sessionId, null)
          await fs.rm(path.join(this.session(call.round.sessionId), 'current.json'), { force: true }).catch(() => {})
          throw error
        }
      }
      const manifest = await this.read(call.round)
      if (!current.resumed && JSON.stringify(manifest.inputMessageIds) !== JSON.stringify(call.round.inputMessageIds))
        throw new Error('Round ownership mismatch')
      const target = path.resolve(call.filePath)
      const identity = await resolveExistingPath(path.resolve(call.filePath))
      const prior = manifest.files
        .flatMap((f) => f.attempts.map((a) => ({ file: f, attempt: a })))
        .find(({ attempt }) => attempt.callId === call.callId)
      if (prior) {
        if (
          (prior.file.identity ?? prior.file.path) !== identity ||
          prior.attempt.runtime !== call.runtime ||
          prior.attempt.toolName !== call.toolName ||
          prior.attempt.origin !== call.origin
        )
          throw new Error('Call ID reused for another target')
        return { attemptId: prior.attempt.id, classification: prior.attempt.classification }
      }
      let file = manifest.files.find((f) => (f.identity ?? f.path) === identity)
      const parent = await parentIdentity(target)
      const before = await inspectFile(target, this.maxFileBytes)
      if (JSON.stringify(parent) !== JSON.stringify(await parentIdentity(target)))
        throw new Error('Snapshot parent changed while reading')
      if (!file) {
        const { state, bytes } = before
        const blob = bytes ? `${randomUUID()}.bin` : null
        if (blob) await atomicWrite(path.join(this.roundDir(call.round), 'blobs', blob), bytes!, 0o600)
        file = {
          path: target,
          identity,
          existedBefore: state.exists,
          sizeBefore: state.size,
          sha256Before: state.sha256,
          modeBefore: state.mode,
          parent,
          afterHash: null,
          afterSize: null,
          restoredAt: null,
          blob,
          attempts: []
        }
        manifest.files.push(file)
      }
      if (file.restoredAt) throw new Error('Cannot write to an undone round')
      const attemptId = randomUUID()
      const candidate = candidateBytesFor(call.intent.toolName, call.intent.input, before.bytes ?? Buffer.alloc(0))
      const classification = classifyDestructiveWrite(
        { exists: before.state.exists, bytes: before.bytes ?? Buffer.alloc(0) },
        candidate
      )
      file.attempts.push({
        id: attemptId,
        callId: call.callId,
        runtime: call.runtime,
        toolName: call.toolName,
        ...(call.origin ? { origin: call.origin } : {}),
        startedAt: new Date().toISOString(),
        afterHash: candidate ? createHash('sha256').update(candidate).digest('hex') : null,
        afterSize: candidate ? String(candidate.length) : null,
        classification,
        status: 'pending'
      })
      await this.save(manifest)
      return { attemptId, classification }
    })
  }
  markRoundFinished(sessionId: string, replyId: string): Promise<void> {
    const current = this.currentRounds.get(sessionId)
    const round = current?.manifest.replyId === replyId ? current : undefined
    if (round?.finishPromise) return round.finishPromise
    if (round) round.manifest.finishedAt ??= new Date().toISOString()
    const finish = this.exclusive(sessionId, async () => {
      let matching = round
      try {
        const live = this.currentRounds.get(sessionId)
        matching ??= live?.manifest.replyId === replyId ? live : undefined
        if (matching) {
          matching.manifest.finishedAt ??= new Date().toISOString()
          if (!matching.persisted || matching.failed) return
        }
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(this.roundDir({ sessionId, replyId, inputMessageIds: [] }), 'manifest.json'),
            'utf8'
          )
        ) as Manifest
        if (manifest.finishedAt) return
        manifest.finishedAt = matching?.manifest.finishedAt ?? new Date().toISOString()
        await this.save(manifest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !matching) return
        if (matching) matching.failed = true
        logger.error('Failed to finish file snapshot round', { sessionId, replyId, error })
      }
    })
    if (round) round.finishPromise = finish
    return finish
  }
  async settleWrite(input: {
    round: SnapshotRound
    attemptId: string
    outcome: 'success' | 'failure' | 'cancelled' | 'unknown'
  }): Promise<void> {
    await this.exclusive(input.round.sessionId, async () => {
      const manifest = await this.read(input.round)
      const current = this.currentRounds.get(input.round.sessionId)
      if (
        !(current?.resumed && current.manifest.replyId === input.round.replyId) &&
        !isInputPrefix(input.round.inputMessageIds, manifest.inputMessageIds)
      )
        throw new Error('Round ownership mismatch')
      const file = manifest.files.find((f) => f.attempts.some((a) => a.id === input.attemptId))
      if (!file) throw new Error('Unknown snapshot attempt')
      const attempt = file.attempts.find((a) => a.id === input.attemptId)!
      if (attempt.status !== 'pending') return
      if (input.outcome === 'success') {
        file.afterHash = attempt.afterHash
        file.afterSize = attempt.afterSize
        file.afterMode = await fs
          .stat(file.path, { bigint: true })
          .then((stat) => Number(stat.mode & 0o7777n))
          .catch(() => null)
      }
      attempt.status =
        input.outcome === 'success'
          ? attempt.afterSize !== null && Number(attempt.afterSize) > this.maxFileBytes
            ? 'unverifiable'
            : attempt.afterHash
              ? 'written'
              : 'unknown'
          : input.outcome === 'failure'
            ? 'failed'
            : input.outcome === 'cancelled'
              ? 'cancelled'
              : 'unknown'
      await this.save(manifest)
    })
  }
  private async isAttested(sessionId: string, attest?: AttestRound): Promise<boolean> {
    if (!attest) return true
    const replyId = attest()
    if (!replyId) return false
    try {
      const disk = JSON.parse(await fs.readFile(path.join(this.session(sessionId), 'current.json'), 'utf8')) as {
        replyId: string
      }
      const current = this.currentRounds.get(sessionId)
      return (
        disk.replyId === replyId &&
        attest() === replyId &&
        (!this.currentRounds.has(sessionId) || current?.manifest.replyId === replyId)
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async cancelStalePending(manifest: Manifest, attest?: AttestRound): Promise<boolean> {
    if (!manifest.finishedAt) return true
    let changed = false
    const hasUntimed = manifest.files.some((file) =>
      file.attempts.some((attempt) => attempt.status === 'pending' && !Number.isFinite(Date.parse(attempt.startedAt)))
    )
    const lastSave = hasUntimed ? (await fs.stat(path.join(this.roundDir(manifest), 'manifest.json'))).mtimeMs : NaN
    for (const file of manifest.files) {
      const stale = file.attempts.filter((attempt) => {
        const started = Date.parse(attempt.startedAt)
        return attempt.status === 'pending' && Date.now() - (Number.isFinite(started) ? started : lastSave) > 120_000
      })
      if (stale.length && (await pendingMatchesBaseline(file, this.maxFileBytes))) {
        for (const attempt of stale) attempt.status = 'cancelled'
        changed = true
      }
    }
    if (changed) {
      if (!(await this.isAttested(manifest.sessionId, attest))) return false
      await this.save(manifest)
    }
    return true
  }

  async getUndoState(sessionId: string, attest?: AttestRound) {
    return this.exclusive(sessionId, async () => {
      const stale = { sessionId, replyId: null, revision: null, files: [], canUndo: false, reason: 'stale' as const }
      if (!(await this.isAttested(sessionId, attest))) return stale
      let replyId: string
      const current = this.currentRounds.get(sessionId)
      if (this.currentRounds.has(sessionId)) {
        if (!current)
          return { sessionId, replyId: null, revision: null, files: [], canUndo: false, reason: 'no-round' as const }
        replyId = current.manifest.replyId
      } else
        try {
          replyId = (
            JSON.parse(await fs.readFile(path.join(this.session(sessionId), 'current.json'), 'utf8')) as {
              replyId: string
            }
          ).replyId
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return { sessionId, replyId: null, revision: null, files: [], canUndo: false, reason: 'no-round' as const }
          throw error
        }
      const manifest = await this.read({ sessionId, replyId, inputMessageIds: [] })
      if (!(await this.cancelStalePending(manifest, attest))) return stale
      const pendingFiles = manifest.files.filter((f) => !f.restoredAt && f.attempts.some((a) => a.status === 'pending'))
      const files = await Promise.all(
        manifest.files.map(async (file) => {
          let conflict = false
          if (!file.restoredAt) {
            if (pendingFiles.includes(file)) conflict = !(await pendingMatchesBaseline(file, this.maxFileBytes))
            else if (file.afterHash && !file.attempts.some((attempt) => attempt.status === 'unverifiable'))
              conflict = (await currentFileState(file, this.maxFileBytes)) === 'conflict'
          }
          return {
            ...file,
            status: file.restoredAt
              ? ('already-restored' as const)
              : conflict
                ? ('conflict' as const)
                : file.attempts.some((attempt) => attempt.status === 'unknown')
                  ? ('unknown' as const)
                  : ('changed' as const)
          }
        })
      )
      if (!(await this.isAttested(sessionId, attest))) return stale
      const reason: AgentFileSnapshotReason | null = current?.failed
        ? 'failed'
        : !manifest.finishedAt
          ? 'turn-active'
          : pendingFiles.length
            ? 'pending'
            : files.some((file) => file.status === 'conflict')
              ? 'conflict'
              : manifest.files.some(
                    (f) =>
                      f.attempts.some((a) => a.status === 'unknown') ||
                      (!f.afterHash && f.attempts.some((a) => a.status === 'written'))
                  )
                ? 'unknown'
                : manifest.files.length === 0
                  ? 'empty'
                  : manifest.files.every((f) => f.restoredAt)
                    ? 'restored'
                    : null
      return { sessionId, replyId, revision: manifest.revision, files, canUndo: reason === null, reason }
    })
  }

  async undoCurrentRound(
    input: { sessionId: string; replyId: string; expectedRevision: string },
    attest?: AttestRound
  ): Promise<{ files: UndoFileResult[]; reason: AgentFileSnapshotReason | null }> {
    return this.exclusive(input.sessionId, async () => {
      if (!(await this.isAttested(input.sessionId, attest))) return { files: [], reason: 'stale' }
      const live = this.currentRounds.get(input.sessionId)
      const current = this.currentRounds.has(input.sessionId)
        ? live?.manifest.replyId
        : (
            JSON.parse(await fs.readFile(path.join(this.session(input.sessionId), 'current.json'), 'utf8')) as {
              replyId: string
            }
          ).replyId
      if (current !== input.replyId) return { files: [], reason: attest ? 'stale' : 'round-mismatch' }
      const manifest = await this.read({ ...input, inputMessageIds: [] })
      if (live?.failed) return { files: [], reason: 'failed' }
      if (!manifest.finishedAt) return { files: [], reason: 'turn-active' }
      if (manifest.revision !== input.expectedRevision) return { files: [], reason: 'revision-mismatch' }
      if (manifest.files.length === 0) return { files: [], reason: 'empty' }
      if (!(await this.cancelStalePending(manifest, attest))) return { files: [], reason: 'stale' }
      if (manifest.files.some((f) => f.attempts.some((a) => a.status === 'pending')))
        return { files: [], reason: 'pending' }
      if (
        manifest.files.some(
          (f) =>
            f.attempts.some((a) => a.status === 'unknown') ||
            (!f.afterHash && f.attempts.some((a) => a.status === 'written'))
        )
      )
        return { files: [], reason: 'unknown' }
      const conflicts = new Set<string>()
      for (const file of manifest.files) {
        if (file.restoredAt || !file.afterHash || file.attempts.some((a) => a.status === 'unverifiable')) continue
        if ((await currentFileState(file, this.maxFileBytes)) === 'conflict') conflicts.add(file.path)
      }
      if (!(await this.isAttested(input.sessionId, attest))) return { files: [], reason: 'stale' }
      if (conflicts.size)
        return {
          files: manifest.files.map((f) => ({
            path: f.path,
            status: f.restoredAt ? 'already-restored' : conflicts.has(f.path) ? 'conflict' : 'unknown'
          })),
          reason: 'conflict'
        }
      const files: UndoFileResult[] = []
      for (const file of manifest.files) {
        if (file.attempts.some((a) => a.status === 'unverifiable')) {
          files.push({ path: file.path, status: 'unverifiable', reason: 'unverifiable' })
          continue
        }
        if (!file.afterHash) {
          files.push({ path: file.path, status: 'skipped' })
          continue
        }
        if (file.restoredAt || (await currentFileState(file, this.maxFileBytes)) === 'baseline') {
          files.push({ path: file.path, status: 'already-restored' })
          continue
        }
        try {
          const bytes = file.existedBefore
            ? await fs.readFile(path.join(this.roundDir(manifest), 'blobs', file.blob!))
            : null
          if (
            bytes &&
            (String(bytes.length) !== file.sizeBefore ||
              createHash('sha256').update(bytes).digest('hex') !== file.sha256Before)
          )
            throw new Error('Snapshot blob corrupt')
          if ((await currentFileState(file, this.maxFileBytes)) !== 'after') {
            files.push({ path: file.path, status: 'conflict' })
            continue
          }
          if (!(await this.isAttested(input.sessionId, attest))) return { files, reason: 'stale' }
          if (bytes) await atomicWrite(file.path, bytes, file.modeBefore ?? undefined)
          else await fs.unlink(file.path)
          file.restoredAt = new Date().toISOString()
          try {
            await this.save(manifest)
          } catch (error) {
            file.restoredAt = null
            throw error
          }
          files.push({ path: file.path, status: file.existedBefore ? 'restored' : 'removed' })
        } catch {
          files.push({ path: file.path, status: 'failed' })
        }
      }
      return {
        files,
        reason: files.some((f) => f.status === 'failed' || f.status === 'conflict')
          ? 'partial'
          : files.some((f) => f.status === 'unverifiable')
            ? 'unverifiable'
            : null
      }
    })
  }
  async sweepOrphans(
    existingSessionIds: ReadonlySet<string>,
    options: { freshnessGateMs: number; now: number },
    signal?: AbortSignal
  ): Promise<string[]> {
    const removed: string[] = []
    for (const entry of await listEntries(this.root())) {
      signal?.throwIfAborted()
      if (!entry.isDirectory() || existingSessionIds.has(entry.name) || this.busy.has(entry.name)) continue
      await this.exclusive(entry.name, async () => {
        const target = this.session(entry.name)
        if (await reclaimStale(target, options)) removed.push(target)
      })
    }
    return removed
  }
  async purgeSessions(sessionIds: readonly string[]): Promise<void> {
    for (const id of sessionIds)
      await this.exclusive(id, async () => {
        this.currentRounds.delete(id)
        await fs.rm(this.session(id), { recursive: true, force: true })
      })
  }
}
