import { randomUUID } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { Mutex } from 'async-mutex'

import {
  createMemoryBackup,
  hasCompletedRecovery,
  hasOrderedRecovery,
  decodeOriginal,
  latestMemoryBackup,
  memoryBatchStatus,
  type MemoryBatch,
  type MemoryFileChange,
  type MemoryLegacyOriginal,
  type MemoryMutationSource,
  reconcileMemoryBackup,
  saveMemoryBackup
} from './memoryBackups'
import {
  entriesIn,
  forgottenEntry,
  invalidEntries,
  memorySourceKey,
  memoryModelView,
  type MemoryUse,
  type MemoryEntry,
  parseMemoryEntries,
  serializeMemoryEntries,
  isMemoryRevision,
  memoryFactText,
  reviseMemory,
  retiredMemoryFacts,
  type MemoryRevision
} from './memoryEntries'
import {
  assertMemoryContent,
  assertMemoryPath,
  assertMemoryTarget,
  initializeMemoryFiles,
  listMemoryFiles,
  MEMORY_ENTRY,
  MemoryError,
  memoryHash,
  memoryEntryPreview,
  readMemoryBytes,
  writeMemoryBytes
} from './memoryFiles'

/** Main-only authority, supplied by the session/editor owner, never deserialized from model input. */
export interface MemoryAccess {
  assertAuthorized(): undefined
}

export interface MemoryRead {
  path: string
  content: string | null
  hash: string | null
  receipt: string
}

interface ReadBaseline {
  path: string
  hash: string | null
  generation: number
  afterClear?: boolean
  projected?: boolean
  revisionContent?: string
}

export type MemoryMutation =
  | { kind: 'write'; receipt: string; content: string; transferTarget?: boolean }
  | { kind: 'delete'; receipt: string }

export interface MemoryChangePreview {
  path: string
  expectedHash: string | null
  content: string | null
}

/** Approval binds this exact immutable proposal and returns its live revocation check. */
export type MemoryApproval = (changes: readonly Readonly<MemoryChangePreview>[]) => Promise<() => undefined>

export interface MemoryCommitResult {
  batchId: string | null
  files: Array<{ path: string; hash: string | null; outcome: 'applied' | 'unchanged' | 'conflict' | 'pending' }>
  error?: string
}

export interface MemoryRecoveryPreview {
  token: string
  batchId: string
  files: Array<{ path: string; currentHash: string | null; conflict: boolean }>
}

export interface MemoryClearPreview {
  token: string
  files: Array<{ path: string; hash: string | null }>
}

interface MemoryCommitConditions {
  onWriteStart?: () => void
  readReceipts?: readonly string[]
  clearTargets?: readonly string[]
  legacy?: MemoryLegacyOriginal
}

type RecoveryBatch = Omit<MemoryBatch, 'steps'> & {
  steps: (MemoryBatch['steps'][number] & { restoredHash?: string | null })[]
}

interface RecoveryBaseline {
  batch: RecoveryBatch
  planHash: string
  generation: number
}

/** One instance per scope, owned by the main-process memory service. */
export class MemoryStore {
  private readonly lock = new Mutex()
  private readonly reads = new WeakMap<MemoryAccess, Map<string, ReadBaseline>>()
  private readonly recoveries = new WeakMap<MemoryAccess, Map<string, RecoveryBaseline>>()
  private readonly clears = new WeakMap<
    MemoryAccess,
    Map<string, Array<Pick<MemoryRead, 'path' | 'hash' | 'receipt'>>>
  >()
  private generation = 0

  constructor(
    private readonly root: string,
    private readonly backupRoot: string,
    private readonly backupDataRoot = path.dirname(backupRoot),
    private readonly onInvalidate?: () => void,
    private readonly beforeHistoryWrite?: (batchId: string, changes: readonly MemoryFileChange[]) => void
  ) {
    const relative = path.relative(path.resolve(root), path.resolve(backupRoot))
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
      throw new MemoryError('invalid-path', 'Memory backups must be outside the active scope')
    }
  }

  private checkedBackupRoot(): Promise<string> {
    return assertMemoryPath(this.backupDataRoot, path.relative(this.backupDataRoot, this.backupRoot))
  }

  async initialize(): Promise<void> {
    await this.lock.runExclusive(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      await assertMemoryPath(this.root, '')
      await mkdir(await this.checkedBackupRoot(), { recursive: true, mode: 0o700 })
      await assertMemoryPath(await this.checkedBackupRoot(), '')
      const latest = await this.latestRecoverableBatch(false)
      const deletedEntry = latest?.steps.some(
        (step) => step.path === MEMORY_ENTRY && step.afterHash === null && step.outcome !== 'unchanged'
      )
      await initializeMemoryFiles(this.root, { createEntry: !deletedEntry })
    })
  }

  invalidate(): void {
    this.generation++
    this.onInvalidate?.()
  }

  async list(access: MemoryAccess): Promise<string[]> {
    const generation = this.generation
    access.assertAuthorized()
    const files = await listMemoryFiles(this.root)
    access.assertAuthorized()
    this.assertGeneration(generation)
    return files
  }

  async revisions(access: MemoryAccess): Promise<MemoryEntry[]> {
    access.assertAuthorized()
    const snapshot = await this.entrySnapshot()
    const files = new Map([...snapshot].map(([name, bytes]) => [name, bytes ? this.decode(bytes) : '']))
    memoryModelView(files, MEMORY_ENTRY, 'current')
    access.assertAuthorized()
    return [...files.values()].flatMap((text) => entriesIn(parseMemoryEntries(text))).filter(isMemoryRevision)
  }

  async entry(access: MemoryAccess): Promise<{ content: string; truncated: boolean }> {
    const view = await this.modelRead(access, MEMORY_ENTRY)
    return memoryEntryPreview(view.content ?? '')
  }

  async modelRead(
    access: MemoryAccess,
    target: string,
    purpose: MemoryUse = 'current',
    extractionSources?: readonly MemoryEntry['sources'][number][],
    maintenance = false,
    earliestSourceAt?: number
  ) {
    assertMemoryTarget(target)
    access.assertAuthorized()
    const generation = this.generation
    const snapshot = await this.entrySnapshot()
    const files = new Map([...snapshot].map(([name, bytes]) => [name, bytes ? this.decode(bytes) : '']))
    const content = memoryModelView(files, target, purpose, extractionSources, earliestSourceAt)
    const structured = [...files.values()]
      .flatMap((text) => entriesIn(parseMemoryEntries(text)))
      .filter((entry) => !isMemoryRevision(entry))
    const afterClear =
      purpose === 'extraction' &&
      maintenance &&
      structured.length > 0 &&
      structured.every((entry) => entry.clearedAt !== undefined)
    const validate = async () => {
      access.assertAuthorized()
      this.assertGeneration(generation)
      await this.assertEntrySnapshot(snapshot)
      access.assertAuthorized()
      this.assertGeneration(generation)
    }
    await validate()
    const raw = !structured.length || afterClear ? await this.read(access, target) : undefined
    if (afterClear && raw) this.baseline(access, raw.receipt).afterClear = true
    const hash = memoryHash(snapshot.get(target) ?? null)
    if (raw && raw.hash !== hash) throw new MemoryError('conflict', 'Memory target does not match the listed file')
    if (raw && !maintenance && purpose === 'current' && raw.content !== content)
      this.baseline(access, raw.receipt).projected = true
    await validate()
    return {
      path: target,
      content: maintenance && raw ? raw.content : content,
      hash,
      receipt: purpose === 'historical' ? '' : (raw?.receipt ?? ''),
      validate
    }
  }

  /** Native transcripts require a stable boundary for protected memory states. */
  async assertRuntimeSafe(access: MemoryAccess, assertHistory?: (protection: string | null) => void): Promise<void> {
    access.assertAuthorized()
    const generation = this.generation
    const snapshot = await this.entrySnapshot()
    const files = new Map([...snapshot].map(([name, bytes]) => [name, bytes ? this.decode(bytes) : '']))
    memoryModelView(files, 'MEMORY.md', 'current')
    const protectedEntries = [...files.values()]
      .flatMap((text) => entriesIn(parseMemoryEntries(text)))
      .filter((entry) => entry.status !== 'active' && !isMemoryRevision(entry))
      .map((entry) => JSON.stringify(entry))
      .sort()
    await this.assertEntrySnapshot(snapshot)
    access.assertAuthorized()
    this.assertGeneration(generation)
    const protection = protectedEntries.length ? memoryHash(Buffer.from(JSON.stringify(protectedEntries))) : null
    if (assertHistory) assertHistory(protection)
    else if (protection)
      throw new MemoryError('conflict', 'Memory history requires isolation before this runtime can continue')
  }

  async read(access: MemoryAccess, target: string): Promise<MemoryRead> {
    assertMemoryTarget(target)
    access.assertAuthorized()
    const generation = this.generation
    const bytes = await readMemoryBytes(this.root, target)
    const content = bytes === null ? null : this.decode(bytes)
    if (content !== null) parseMemoryEntries(content)
    access.assertAuthorized()
    this.assertGeneration(generation)
    const receipt = randomUUID()
    const hash = memoryHash(bytes)
    let receipts = this.reads.get(access)
    if (!receipts) {
      receipts = new Map()
      this.reads.set(access, receipts)
    }
    receipts.set(receipt, { path: target, hash, generation })
    return { path: target, content, hash, receipt }
  }

  async prepareRevisions(
    access: MemoryAccess,
    receipt: string,
    revisions: readonly MemoryRevision[],
    additions: readonly string[] = []
  ): Promise<MemoryMutation & { content: string }> {
    access.assertAuthorized()
    const baseline = this.baseline(access, receipt)
    const bytes = await this.readMatching(baseline)
    const content = reviseMemory(bytes ? this.decode(bytes) : '', revisions, additions)
    access.assertAuthorized()
    const bound = randomUUID()
    this.reads.get(access)!.set(bound, { ...baseline, projected: false, revisionContent: content })
    return { kind: 'write', receipt: bound, content }
  }

  async commit(
    access: MemoryAccess,
    mutations: readonly MemoryMutation[],
    source: MemoryMutationSource,
    approve: MemoryApproval,
    conditions: MemoryCommitConditions = {}
  ): Promise<MemoryCommitResult> {
    if (source === 'clear' || source === 'recovery')
      throw new MemoryError('conflict', 'Use the dedicated memory operation')
    return this.commitProtected(access, mutations, source, approve, conditions, false)
  }

  private async commitProtected(
    access: MemoryAccess,
    mutations: readonly MemoryMutation[],
    source: MemoryMutationSource,
    approve: MemoryApproval,
    conditions: MemoryCommitConditions,
    clearing: boolean
  ): Promise<MemoryCommitResult> {
    const intent = mutations.map((mutation) => ({ ...mutation }))
    access.assertAuthorized()
    const generation = this.generation
    const dependencies = (conditions.readReceipts ?? []).map((receipt) => this.baseline(access, receipt))
    const legacy = conditions.legacy
      ? { path: conditions.legacy.path, content: Buffer.from(conditions.legacy.content) }
      : undefined
    if (legacy && (source !== 'migration' || !/^memory\/fact\.md$/i.test(legacy.path)))
      throw new MemoryError('invalid-path', 'Only a trusted migration can back up legacy FACT content')
    const assertLegacy = async () => {
      if (legacy && memoryHash(await readMemoryBytes(this.root, legacy.path)) !== memoryHash(legacy.content))
        throw new MemoryError('conflict', 'Legacy FACT changed during migration')
    }
    await assertLegacy()
    const clearTargets = conditions.clearTargets ? [...conditions.clearTargets] : undefined
    const changes: MemoryFileChange[] = []
    const revised = new Set<string>()
    const afterClear = new Set<string>()
    for (const mutation of intent) {
      const baseline = this.baseline(access, mutation.receipt)
      const before = await this.readMatching(baseline)
      if (source === 'extraction' && baseline.afterClear) afterClear.add(baseline.path)
      if (baseline.revisionContent !== undefined) {
        if (source !== 'extraction' || mutation.kind !== 'write' || mutation.content !== baseline.revisionContent)
          invalidEntries()
        revised.add(baseline.path)
      }
      if (mutation.kind === 'write') {
        let content = mutation.content
        if (baseline.projected) {
          if (entriesIn(parseMemoryEntries(content)).length) invalidEntries()
          const retained = entriesIn(parseMemoryEntries(before ? this.decode(before) : ''))
          content = serializeMemoryEntries([content, ...retained])
        }
        assertMemoryContent(baseline.path, content)
        changes.push({
          path: baseline.path,
          before,
          after: Buffer.from(content),
          transferTarget: source === 'dreaming' && mutation.transferTarget
        })
      } else {
        if (before === null) throw new MemoryError('conflict', 'Cannot delete an absent memory file')
        changes.push({ path: baseline.path, before, after: null })
      }
    }
    await this.assertDistinctTargets(changes)
    const scope = await this.entrySnapshot()
    this.protectEntries(changes, scope, clearing ? 'clear' : 'ordinary', revised, afterClear)
    this.assertGeneration(generation)
    access.assertAuthorized()
    const approval = await approve(this.preview(changes))
    const validateApproval = (): undefined => {
      approval()
      access.assertAuthorized()
      return undefined
    }
    return this.lock.runExclusive(async () => {
      access.assertAuthorized()
      validateApproval()
      this.assertGeneration(generation)
      for (const baseline of dependencies) await this.readMatching(baseline)
      if (clearTargets && JSON.stringify(await listMemoryFiles(this.root)) !== JSON.stringify(clearTargets)) {
        throw new MemoryError('conflict', 'The managed file set changed since the clear preview')
      }
      for (const change of changes)
        await this.readMatching({ path: change.path, hash: memoryHash(change.before), generation })
      await this.assertDistinctTargets(changes)
      await assertLegacy()
      await this.assertEntrySnapshot(scope)
      this.assertGeneration(generation)
      const advanceGeneration = source === 'clear' || source === 'recovery'
      if (advanceGeneration) this.invalidate()
      return this.apply(
        access,
        changes,
        source,
        validateApproval,
        generation + Number(advanceGeneration),
        legacy,
        undefined,
        conditions.onWriteStart
      )
    })
  }

  async previewClear(access: MemoryAccess): Promise<MemoryClearPreview> {
    return this.lock.runExclusive(async () => {
      const files: Array<Pick<MemoryRead, 'path' | 'hash' | 'receipt'>> = []
      for (const target of await this.list(access)) {
        const { path, hash, receipt } = await this.read(access, target)
        files.push({ path, hash, receipt })
      }
      access.assertAuthorized()
      const token = randomUUID()
      this.clears.set(access, new Map([[token, files]]))
      return { token, files: files.map(({ path, hash }) => ({ path, hash })) }
    })
  }

  async clear(access: MemoryAccess, token: string, approve: MemoryApproval): Promise<MemoryCommitResult> {
    access.assertAuthorized()
    const files = this.clears.get(access)?.get(token)
    if (!files) throw new MemoryError('invalid-receipt', 'Clear requires this caller to preview the managed file set')
    const mutations: MemoryMutation[] = files.map((file) =>
      file.path === MEMORY_ENTRY
        ? { kind: 'write', receipt: file.receipt, content: '' }
        : { kind: 'delete', receipt: file.receipt }
    )
    const result = await this.commitProtected(
      access,
      mutations,
      'clear',
      approve,
      {
        clearTargets: files.map((file) => file.path)
      },
      true
    )
    this.clears.delete(access)
    return result
  }

  async previewRecovery(access: MemoryAccess): Promise<MemoryRecoveryPreview | undefined> {
    return this.lock.runExclusive(async () => {
      const generation = this.generation
      access.assertAuthorized()
      const batch = await this.latestRecoverableBatch()
      if (!batch) return undefined
      const scope = await this.entrySnapshot()
      const { changes, files } = this.recoveryChanges(batch, scope)
      access.assertAuthorized()
      const token = randomUUID()
      this.assertGeneration(generation)
      try {
        this.protectRecovery(batch, changes, scope)
      } catch (error) {
        if (!(error instanceof MemoryError) || error.code !== 'conflict') throw error
        for (const file of files) file.conflict = true
      }
      const planHash = this.recoveryPlanHash(batch, scope, files, changes)
      this.recoveries.set(access, new Map([[token, { batch, planHash, generation: this.generation }]]))
      return { token, batchId: batch.id, files }
    })
  }

  async recover(access: MemoryAccess, token: string, approve: MemoryApproval): Promise<MemoryCommitResult> {
    access.assertAuthorized()
    const preview = this.recoveries.get(access)?.get(token)
    if (!preview) throw new MemoryError('invalid-receipt', 'Recovery requires this caller to preview the latest batch')
    this.assertGeneration(preview.generation)
    const scope = await this.entrySnapshot()
    const { changes, files } = this.recoveryChanges(preview.batch, scope)
    const conflicts = files
      .filter((file) => file.conflict)
      .map((file) => ({ path: file.path, hash: file.currentHash, outcome: 'conflict' as const }))
    this.protectRecovery(preview.batch, changes, scope)
    if (this.recoveryPlanHash(preview.batch, scope, files, changes) !== preview.planHash)
      throw new MemoryError('conflict', 'Recovery preview is stale')
    this.assertGeneration(preview.generation)
    access.assertAuthorized()
    const approval = await approve(this.preview(changes))
    const validateApproval = (): undefined => {
      approval()
      access.assertAuthorized()
      return undefined
    }
    return this.lock.runExclusive(async () => {
      access.assertAuthorized()
      validateApproval()
      this.assertGeneration(preview.generation)
      const confirmations: Array<() => Promise<void>> = []
      const currentPlan = await this.latestRecoverableBatch(true, confirmations)
      if (JSON.stringify(currentPlan) !== JSON.stringify(preview.batch)) {
        throw new MemoryError('conflict', 'A newer memory operation requires a new recovery preview')
      }
      await this.assertEntrySnapshot(scope)
      this.assertGeneration(preview.generation)
      this.recoveries.delete(access)
      this.invalidate()
      for (const confirm of confirmations) await confirm()
      const root = await this.checkedBackupRoot()
      const manifest = await latestMemoryBackup(root, preview.batch.id)
      if (!manifest) throw new MemoryError('conflict', 'The recovery manifest is unavailable')
      const previousStatus = manifest.status
      manifest.status = 'partial'
      await saveMemoryBackup(root, manifest)
      let result: MemoryCommitResult
      try {
        result = await this.apply(
          access,
          changes,
          'recovery',
          validateApproval,
          preview.generation + 1,
          undefined,
          preview.batch.id
        )
      } catch (error) {
        manifest.status = previousStatus
        await saveMemoryBackup(root, manifest).catch(() => undefined)
        throw error
      }
      if (
        !result.error &&
        !conflicts.length &&
        result.files.every((file) => file.outcome === 'applied' || file.outcome === 'unchanged')
      ) {
        manifest.status = 'completed'
        try {
          await saveMemoryBackup(root, manifest)
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error)
        }
      }
      result.files.push(...conflicts)
      return result
    })
  }

  private async apply(
    access: MemoryAccess,
    proposed: readonly MemoryFileChange[],
    source: MemoryMutationSource,
    approval: () => undefined,
    generation: number,
    legacy?: MemoryLegacyOriginal,
    recoveryOf?: string,
    onWriteStart?: () => void
  ): Promise<MemoryCommitResult> {
    access.assertAuthorized()
    approval()
    this.assertGeneration(generation)
    const changes = proposed.filter((change) => memoryHash(change.before) !== memoryHash(change.after))
    if (!changes.length && !legacy) {
      return {
        batchId: null,
        files: proposed.map((change) => ({ path: change.path, hash: memoryHash(change.before), outcome: 'unchanged' }))
      }
    }
    const clearScopeHash =
      source === 'clear'
        ? this.scopeHash(new Map(proposed.map(({ path, after }) => [path, memoryHash(after)])))
        : undefined
    const batch = await createMemoryBackup(await this.checkedBackupRoot(), changes, source, {
      legacy,
      clearScopeHash,
      recoveryOf,
      activeRoot: this.root,
      transferTargets: proposed
        .filter((change) => change.transferTarget && memoryHash(change.before) === memoryHash(change.after))
        .map((change) => ({ path: change.path, hash: memoryHash(change.after) }))
    })
    const steps = new Map(batch.steps.map((step) => [step.path, step]))
    const result: MemoryCommitResult = {
      batchId: batch.id,
      files: changes.map((change) => ({ path: change.path, hash: memoryHash(change.before), outcome: 'pending' }))
    }
    if (source === 'clear' || source === 'recovery') this.beforeHistoryWrite?.(batch.id, changes)
    for (const [index, change] of changes.entries()) {
      const step = steps.get(change.path)!
      try {
        access.assertAuthorized()
        approval()
        this.assertGeneration(generation)
        await this.readMatching({ path: change.path, hash: memoryHash(change.before), generation })
        await writeMemoryBytes(this.root, change.path, change.after, () => {
          access.assertAuthorized()
          approval()
          this.assertGeneration(generation)
          onWriteStart?.()
        })
        const actual = await readMemoryBytes(this.root, change.path)
        if (memoryHash(actual) !== memoryHash(change.after))
          throw new MemoryError('conflict', 'Memory save result changed')
        step.outcome = 'applied'
        result.files[index] = { path: change.path, hash: memoryHash(actual), outcome: 'applied' }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
        try {
          const actual = memoryHash(await readMemoryBytes(this.root, change.path))
          const outcome =
            actual === memoryHash(change.after)
              ? 'applied'
              : actual === memoryHash(change.before)
                ? 'unchanged'
                : 'conflict'
          step.outcome = outcome
          result.files[index] = { path: change.path, hash: actual, outcome }
        } catch {
          // Keep the pending manifest when the actual disk result cannot be read.
        }
        for (const file of result.files.slice(index + 1)) {
          steps.get(file.path)!.outcome = 'unchanged'
          file.outcome = 'unchanged'
        }
        batch.status = memoryBatchStatus(batch)
        await saveMemoryBackup(await this.checkedBackupRoot(), batch).catch(() => undefined)
        return result
      }
    }
    batch.status = memoryBatchStatus(batch)
    try {
      await saveMemoryBackup(await this.checkedBackupRoot(), batch)
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    return result
  }

  private async latestRecoverableBatch(
    resume = true,
    confirmations?: Array<() => Promise<void>>
  ): Promise<RecoveryBatch | undefined> {
    let batch = await latestMemoryBackup(await this.checkedBackupRoot())
    while (batch) {
      batch = await reconcileMemoryBackup(await this.checkedBackupRoot(), this.root, batch)
      if (batch.steps.some((step) => step.outcome !== 'unchanged')) {
        if (batch.recoveryOf) {
          const original: RecoveryBatch | undefined = await latestMemoryBackup(
            await this.checkedBackupRoot(),
            batch.recoveryOf
          )
          if (original?.status === 'partial') {
            const completedManifest = {
              ...original,
              steps: original.steps.map((step) => ({ ...step })),
              status: 'completed' as const
            }
            const confirmed: MemoryFileChange[] = []
            const root = await this.checkedBackupRoot()
            if (!resume) {
              if (hasCompletedRecovery(original, batch)) await saveMemoryBackup(root, completedManifest)
              return batch
            }
            const predecessor = original.recoveryOf ? await latestMemoryBackup(root, original.recoveryOf) : undefined
            for (const step of original.steps) {
              if (step.outcome === 'unchanged') continue
              const reverse = batch.steps.find((candidate) => candidate.path === step.path)
              const current = await readMemoryBytes(this.root, step.path)
              const currentHash = memoryHash(current)
              if (
                reverse?.outcome === 'applied' &&
                reverse.beforeHash === step.afterHash &&
                (!hasOrderedRecovery(original) || currentHash === reverse.afterHash)
              ) {
                step.outcome = 'unchanged'
                step.restoredHash = reverse.afterHash
                continue
              }
              if (currentHash !== step.beforeHash) continue
              if (reverse?.outcome !== 'applied') {
                // Rebuild the inverse only from verified originals; a matching live hash alone
                // does not tell us which bytes an eventual undo should put back.
                const prior =
                  reverse ??
                  predecessor?.steps.find((item) => item.path === step.path && item.beforeHash === step.afterHash)
                if (original.recoveryOf && prior?.beforeHash !== step.afterHash) continue
                if (prior?.beforeHash === step.afterHash)
                  confirmed.push({ path: step.path, before: decodeOriginal(prior), after: current })
              }
              step.outcome = 'unchanged'
            }
            if (confirmed.length) {
              const options = { recoveryOf: original.id, confirmed }
              batch = await createMemoryBackup(root, [], 'recovery', { ...options, preview: true })
              confirmations?.push(async () => {
                await createMemoryBackup(root, [], 'recovery', options)
              })
            }
            if (original.steps.some((step) => step.outcome !== 'unchanged')) return resume ? original : batch
            confirmations?.push(() => saveMemoryBackup(root, completedManifest))
          }
        }
        return batch
      }
      batch = await latestMemoryBackup(await this.checkedBackupRoot())
    }
    return undefined
  }

  private async entrySnapshot(): Promise<Map<string, Buffer | null>> {
    const snapshot = new Map<string, Buffer | null>()
    const ids = new Set<string>()
    let bytes = 0
    for (const target of await listMemoryFiles(this.root)) {
      const content = await readMemoryBytes(this.root, target)
      bytes += content?.length ?? 0
      if (bytes > 20 * 1024 * 1024) throw new MemoryError('limit', 'Memory state scan exceeds the read budget')
      for (const entry of entriesIn(parseMemoryEntries(content ? this.decode(content) : ''))) {
        if (ids.has(entry.id)) invalidEntries()
        ids.add(entry.id)
      }
      snapshot.set(target, content)
    }
    return snapshot
  }

  private async assertEntrySnapshot(expected: Map<string, Buffer | null>): Promise<void> {
    const actual = await this.entrySnapshot()
    if (
      actual.size !== expected.size ||
      [...expected].some(
        ([target, bytes]) => !actual.has(target) || memoryHash(actual.get(target) ?? null) !== memoryHash(bytes)
      )
    ) {
      throw new MemoryError('conflict', 'Memory entry state changed during approval')
    }
  }

  private recoveryChanges(batch: RecoveryBatch, scope: Map<string, Buffer | null>) {
    const changes: MemoryFileChange[] = []
    const files: MemoryRecoveryPreview['files'] = []
    const restoringMerge = hasOrderedRecovery(batch)
    const steps = restoringMerge ? batch.steps.toReversed() : batch.steps
    let prerequisiteConflict =
      batch.dependencies?.some(
        (dep) =>
          !batch.steps.some((step) => step.path === dep.path) && memoryHash(scope.get(dep.path) ?? null) !== dep.hash
      ) ?? false
    for (const step of steps) {
      const before = scope.get(step.path) ?? null
      const currentHash = memoryHash(before)
      if (step.outcome === 'unchanged') {
        if (restoringMerge && currentHash !== (step.restoredHash === undefined ? step.beforeHash : step.restoredHash))
          prerequisiteConflict = true
        continue
      }
      const conflict = currentHash !== step.afterHash || prerequisiteConflict
      files.push({ path: step.path, currentHash, conflict })
      if (conflict) {
        if (restoringMerge) prerequisiteConflict = true
      } else {
        changes.push({ path: step.path, before, after: decodeOriginal(step) })
      }
    }
    return { changes, files }
  }

  private protectRecovery(batch: RecoveryBatch, changes: MemoryFileChange[], scope: Map<string, Buffer | null>): void {
    if (batch.source === 'clear') {
      const hashes = new Map([...scope].map(([target, bytes]) => [target, memoryHash(bytes)]))
      const matches = batch.steps.every((step) => {
        const actual = hashes.get(step.path) ?? null
        const expected =
          step.outcome === 'unchanged'
            ? step.restoredHash === undefined
              ? step.beforeHash
              : step.restoredHash
            : step.afterHash
        if (actual !== expected) return false
        hashes.set(step.path, step.afterHash)
        return true
      })
      if (
        matches &&
        (batch.clearScopeHash
          ? this.scopeHash(hashes) === batch.clearScopeHash
          : [...scope].every(([target, bytes]) => !bytes?.length || batch.steps.some((step) => step.path === target)))
      )
        return
    }
    if (
      batch.source === 'extraction' &&
      changes.every((change) => {
        const current = this.decode(change.before ?? Buffer.alloc(0))
        const original = this.decode(change.after ?? Buffer.alloc(0))
        assertMemoryContent(change.path, original)
        parseMemoryEntries(original)
        // Removing an appended suffix preserves the original text and every protection marker.
        const prefix = original.length && !original.endsWith('\n') ? original + '\n' : original
        return current.startsWith(prefix) && !entriesIn(parseMemoryEntries(current.slice(prefix.length))).length
      })
    )
      return
    this.protectEntries(changes, scope, 'recovery')
  }

  private recoveryPlanHash(
    batch: RecoveryBatch,
    scope: Map<string, Buffer | null>,
    files: MemoryRecoveryPreview['files'],
    changes: MemoryFileChange[]
  ): string {
    const dependencies = [
      ...(batch.dependencies ?? []).map((dependency) => dependency.path),
      ...(hasOrderedRecovery(batch)
        ? batch.steps.filter((step) => step.outcome === 'unchanged').map((step) => step.path)
        : [])
    ]
    return memoryHash(
      Buffer.from(
        JSON.stringify([
          files,
          changes.map((change) => [change.path, memoryHash(change.after)]),
          dependencies.map((path) => [path, memoryHash(scope.get(path) ?? null)])
        ])
      )
    )
  }

  private scopeHash(scope: Map<string, string | null>): string {
    const files = [...scope.keys()].sort().filter((target) => scope.get(target) !== null)
    return memoryHash(Buffer.from(JSON.stringify(files.map((target) => [target, scope.get(target)]))))
  }

  private protectEntries(
    changes: MemoryFileChange[],
    scope: Map<string, Buffer | null>,
    mode: 'ordinary' | 'clear' | 'recovery',
    revised: ReadonlySet<string> = new Set(),
    afterClear: ReadonlySet<string> = new Set()
  ): void {
    const parse = (bytes: Buffer | null) => parseMemoryEntries(bytes === null ? '' : this.decode(bytes))
    const protectedEntries = [...scope.values()]
      .flatMap((bytes) => entriesIn(parse(bytes)))
      .filter((entry) => entry.status !== 'active' && !isMemoryRevision(entry))
    const blockedSources = new Set(protectedEntries.flatMap((entry) => entry.sources.map(memorySourceKey)))
    const blockedIds = new Set(protectedEntries.map((entry) => entry.id))
    const candidates = [...scope.values(), ...changes.map((change) => change.after)].flatMap((bytes) =>
      entriesIn(parse(bytes))
    )
    const retiredFacts = retiredMemoryFacts([...scope.values()].flatMap((bytes) => entriesIn(parse(bytes))))
    let size: number
    do {
      size = blockedIds.size
      for (const entry of candidates) {
        if (
          entry.sources.some((source) => blockedSources.has(memorySourceKey(source))) ||
          entry.derivedFrom.some((id) => blockedIds.has(id))
        )
          blockedIds.add(entry.id)
      }
    } while (size !== blockedIds.size)
    for (const change of changes) {
      const before = parse(change.before)
      const oldEntries = entriesIn(before)
      let after = parse(change.after)
      if (mode === 'recovery') {
        const facts = after
          .filter((part): part is string => typeof part === 'string')
          .join('')
          .split('\n')
          .map(memoryFactText)
        if (facts.some((text) => retiredFacts.has(text))) invalidEntries()
      }
      if (mode === 'clear') {
        after = oldEntries.flatMap((entry) => [
          entry.status === 'forgotten'
            ? entry
            : {
                ...forgottenEntry(entry),
                ...(entry.status === 'active' || isMemoryRevision(entry) ? { clearedAt: Date.now() } : {})
              },
          '\n'
        ])
        if (before.some((part) => typeof part === 'string' && part.trim())) {
          after.push({
            schemaVersion: 1,
            id: randomUUID(),
            status: 'forgotten',
            clearedAt: Date.now(),
            sources: [],
            text: '',
            derivedFrom: []
          })
        }
      } else if (mode === 'ordinary') {
        if (!revised.has(change.path) && JSON.stringify(oldEntries) !== JSON.stringify(entriesIn(after)))
          invalidEntries()
        if (!revised.has(change.path)) {
          const facts = (parts: ReturnType<typeof parse>) =>
            parts
              .filter((part): part is string => typeof part === 'string')
              .join('')
              .split('\n')
              .map(memoryFactText)
          const previous = new Set(facts(before))
          const next = new Set(facts(after))
          if ([...retiredFacts].some((text) => !previous.has(text) && next.has(text))) invalidEntries()
        }
        if (
          protectedEntries.length &&
          (!afterClear.has(change.path) || protectedEntries.some((entry) => entry.clearedAt === undefined)) &&
          JSON.stringify(before.filter((part) => typeof part === 'string')) !==
            JSON.stringify(after.filter((part) => typeof part === 'string'))
        )
          invalidEntries()
      } else {
        if (protectedEntries.length && after.some((part) => typeof part === 'string' && part.trim())) invalidEntries()
        const localProtected = oldEntries.filter((entry) => entry.status !== 'active')
        after = after.map((part) => {
          if (typeof part === 'string') return part
          const current = localProtected.find((entry) => entry.id === part.id)
          if (current) return current
          if (
            blockedIds.has(part.id) ||
            protectedEntries.some((entry) => !entry.sources.length) ||
            (protectedEntries.length > 0 && !part.sources.length)
          )
            invalidEntries()
          return part
        })
        for (const entry of localProtected) {
          if (!entriesIn(after).some((part) => part.id === entry.id)) after.push('\n', entry)
        }
      }
      const content = serializeMemoryEntries(after)
      assertMemoryContent(change.path, content)
      if (mode !== 'ordinary')
        change.after = content ? Buffer.from(content) : change.after === null ? null : Buffer.from('')
    }
    const finalScope = new Map(scope)
    for (const change of changes) finalScope.set(change.path, change.after)
    const finalEntries = [...finalScope.values()].flatMap((bytes) => entriesIn(parse(bytes)))
    const ids = finalEntries.map((entry) => entry.id)
    if (new Set(ids).size !== ids.length) invalidEntries()
  }

  private async assertDistinctTargets(changes: readonly MemoryFileChange[]): Promise<void> {
    const names = new Set<string>()
    const files = new Set<string>()
    for (const change of changes) {
      const name = process.platform === 'win32' ? change.path.toLowerCase() : change.path
      const stat = await lstat(await assertMemoryPath(this.root, change.path), { bigint: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return undefined
        }
      )
      const identity = stat ? `${stat.dev}:${stat.ino}` : undefined
      if (names.has(name) || (identity !== undefined && files.has(identity))) {
        throw new MemoryError('conflict', 'A memory batch must name each physical target once')
      }
      names.add(name)
      if (identity !== undefined) files.add(identity)
    }
  }

  private baseline(access: MemoryAccess, receipt: string): ReadBaseline {
    const baseline = this.reads.get(access)?.get(receipt)
    if (!baseline) throw new MemoryError('invalid-receipt', 'A full read by this caller is required')
    this.assertGeneration(baseline.generation)
    return baseline
  }

  private async readMatching(baseline: ReadBaseline): Promise<Buffer | null> {
    this.assertGeneration(baseline.generation)
    const bytes = await readMemoryBytes(this.root, baseline.path)
    if (memoryHash(bytes) !== baseline.hash) throw new MemoryError('conflict', 'Memory changed since the bound read')
    return bytes
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation)
      throw new MemoryError('invalid-receipt', 'The memory operation has been invalidated')
  }

  private preview(changes: readonly MemoryFileChange[]): readonly Readonly<MemoryChangePreview>[] {
    return Object.freeze(
      changes.map((change) =>
        Object.freeze({
          path: change.path,
          expectedHash: memoryHash(change.before),
          content: change.after === null ? null : this.decode(change.after)
        })
      )
    )
  }

  private decode(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  }
}
