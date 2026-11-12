import { randomUUID } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { Mutex } from 'async-mutex'

import {
  createMemoryBackup,
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
  serializeMemoryEntries
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
}

export type MemoryMutation = { kind: 'write'; receipt: string; content: string } | { kind: 'delete'; receipt: string }

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
  readReceipts?: readonly string[]
  clearTargets?: readonly string[]
  legacy?: MemoryLegacyOriginal
}

interface RecoveryBaseline {
  batch: MemoryBatch
  hashes: Map<string, string | null>
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
    private readonly backupRoot: string
  ) {
    const relative = path.relative(path.resolve(root), path.resolve(backupRoot))
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
      throw new MemoryError('invalid-path', 'Memory backups must be outside the active scope')
    }
  }

  async initialize(): Promise<void> {
    await this.lock.runExclusive(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      await assertMemoryPath(this.root, '')
      await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
      await assertMemoryPath(this.backupRoot, '')
      const latest = await this.latestRecoverableBatch()
      const deletedEntry = latest?.steps.some(
        (step) => step.path === MEMORY_ENTRY && step.afterHash === null && step.outcome !== 'unchanged'
      )
      await initializeMemoryFiles(this.root, { createEntry: !deletedEntry })
    })
  }

  invalidate(): void {
    this.generation++
  }

  async list(access: MemoryAccess): Promise<string[]> {
    const generation = this.generation
    access.assertAuthorized()
    const files = await listMemoryFiles(this.root)
    access.assertAuthorized()
    this.assertGeneration(generation)
    return files
  }

  async entry(access: MemoryAccess): Promise<{ content: string; truncated: boolean }> {
    const view = await this.modelRead(access, MEMORY_ENTRY)
    return memoryEntryPreview(view.content ?? '')
  }

  async modelRead(
    access: MemoryAccess,
    target: string,
    purpose: MemoryUse = 'current',
    extractionSources?: readonly MemoryEntry['sources'][number][]
  ) {
    assertMemoryTarget(target)
    access.assertAuthorized()
    const generation = this.generation
    const snapshot = await this.entrySnapshot()
    const files = new Map([...snapshot].map(([name, bytes]) => [name, bytes ? this.decode(bytes) : '']))
    const content = memoryModelView(files, target, purpose, extractionSources)
    const structured = [...files.values()].some((text) => entriesIn(parseMemoryEntries(text)).length > 0)
    const validate = async () => {
      access.assertAuthorized()
      this.assertGeneration(generation)
      await this.assertEntrySnapshot(snapshot)
      access.assertAuthorized()
      this.assertGeneration(generation)
    }
    await validate()
    const raw = structured ? undefined : await this.read(access, target)
    await validate()
    return {
      path: target,
      content,
      hash: memoryHash(snapshot.get(target) ?? null),
      receipt: raw?.receipt ?? '',
      validate
    }
  }

  /** Native transcripts have no per-fragment memory provenance yet. */
  async assertRuntimeSafe(access: MemoryAccess): Promise<void> {
    access.assertAuthorized()
    const generation = this.generation
    const snapshot = await this.entrySnapshot()
    const files = new Map([...snapshot].map(([name, bytes]) => [name, bytes ? this.decode(bytes) : '']))
    memoryModelView(files, 'MEMORY.md', 'current')
    if (
      [...files.values()].some((text) => entriesIn(parseMemoryEntries(text)).some((entry) => entry.status !== 'active'))
    )
      throw new MemoryError('conflict', 'Memory history requires isolation before this runtime can continue')
    await this.assertEntrySnapshot(snapshot)
    access.assertAuthorized()
    this.assertGeneration(generation)
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

  async commit(
    access: MemoryAccess,
    mutations: readonly MemoryMutation[],
    source: MemoryMutationSource,
    approve: MemoryApproval,
    conditions: MemoryCommitConditions = {}
  ): Promise<MemoryCommitResult> {
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
    for (const mutation of intent) {
      const baseline = this.baseline(access, mutation.receipt)
      const before = await this.readMatching(baseline)
      if (mutation.kind === 'write') {
        assertMemoryContent(baseline.path, mutation.content)
        changes.push({ path: baseline.path, before, after: Buffer.from(mutation.content) })
      } else {
        if (before === null) throw new MemoryError('conflict', 'Cannot delete an absent memory file')
        changes.push({ path: baseline.path, before, after: null })
      }
    }
    await this.assertDistinctTargets(changes)
    const scope = await this.entrySnapshot()
    this.protectEntries(changes, scope, clearing ? 'clear' : 'ordinary')
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
      return this.apply(access, changes, source, validateApproval, generation + Number(advanceGeneration), legacy)
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
      const hashes = new Map<string, string | null>()
      const files: MemoryRecoveryPreview['files'] = []
      for (const step of batch.steps) {
        if (step.outcome === 'unchanged') continue
        const currentHash = memoryHash(await readMemoryBytes(this.root, step.path))
        hashes.set(step.path, currentHash)
        files.push({ path: step.path, currentHash, conflict: currentHash !== step.afterHash })
      }
      access.assertAuthorized()
      const token = randomUUID()
      this.assertGeneration(generation)
      this.recoveries.set(access, new Map([[token, { batch, hashes, generation: this.generation }]]))
      return { token, batchId: batch.id, files }
    })
  }

  async recover(access: MemoryAccess, token: string, approve: MemoryApproval): Promise<MemoryCommitResult> {
    access.assertAuthorized()
    const preview = this.recoveries.get(access)?.get(token)
    if (!preview) throw new MemoryError('invalid-receipt', 'Recovery requires this caller to preview the latest batch')
    this.assertGeneration(preview.generation)
    const changes: MemoryFileChange[] = []
    const conflicts: MemoryCommitResult['files'] = []
    for (const step of preview.batch.steps) {
      if (step.outcome === 'unchanged') continue
      const before = await this.readMatching({
        path: step.path,
        hash: preview.hashes.get(step.path) ?? null,
        generation: preview.generation
      })
      if (memoryHash(before) !== step.afterHash) {
        conflicts.push({ path: step.path, hash: memoryHash(before), outcome: 'conflict' })
      } else {
        changes.push({ path: step.path, before, after: decodeOriginal(step) })
      }
    }
    const scope = await this.entrySnapshot()
    this.protectEntries(changes, scope, 'recovery')
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
      if ((await latestMemoryBackup(this.backupRoot))?.id !== preview.batch.id) {
        throw new MemoryError('conflict', 'A newer memory operation requires a new recovery preview')
      }
      for (const [target, hash] of preview.hashes) {
        await this.readMatching({ path: target, hash, generation: preview.generation })
      }
      await this.assertEntrySnapshot(scope)
      this.assertGeneration(preview.generation)
      this.recoveries.delete(access)
      this.invalidate()
      const previousStatus = preview.batch.status
      preview.batch.status = 'partial'
      await saveMemoryBackup(this.backupRoot, preview.batch)
      let result: MemoryCommitResult
      try {
        result = await this.apply(access, changes, 'recovery', validateApproval, preview.generation + 1)
      } catch (error) {
        preview.batch.status = previousStatus
        await saveMemoryBackup(this.backupRoot, preview.batch).catch(() => undefined)
        throw error
      }
      if (
        !result.error &&
        !conflicts.length &&
        result.files.every((file) => file.outcome === 'applied' || file.outcome === 'unchanged')
      ) {
        preview.batch.status = 'completed'
        try {
          await saveMemoryBackup(this.backupRoot, preview.batch)
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
    legacy?: MemoryLegacyOriginal
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
    const batch = await createMemoryBackup(this.backupRoot, changes, source, legacy)
    const result: MemoryCommitResult = {
      batchId: batch.id,
      files: changes.map((change) => ({ path: change.path, hash: memoryHash(change.before), outcome: 'pending' }))
    }
    for (const [index, change] of changes.entries()) {
      try {
        access.assertAuthorized()
        approval()
        this.assertGeneration(generation)
        await this.readMatching({ path: change.path, hash: memoryHash(change.before), generation })
        await writeMemoryBytes(this.root, change.path, change.after, () => {
          access.assertAuthorized()
          approval()
          this.assertGeneration(generation)
        })
        const actual = await readMemoryBytes(this.root, change.path)
        if (memoryHash(actual) !== memoryHash(change.after))
          throw new MemoryError('conflict', 'Memory save result changed')
        batch.steps[index].outcome = 'applied'
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
          batch.steps[index].outcome = outcome
          result.files[index] = { path: change.path, hash: actual, outcome }
        } catch {
          // Keep the pending manifest when the actual disk result cannot be read.
        }
        for (const step of batch.steps.slice(index + 1)) step.outcome = 'unchanged'
        batch.status = memoryBatchStatus(batch)
        await saveMemoryBackup(this.backupRoot, batch).catch(() => undefined)
        return result
      }
    }
    batch.status = 'completed'
    try {
      await saveMemoryBackup(this.backupRoot, batch)
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    return result
  }

  private async latestRecoverableBatch(): Promise<MemoryBatch | undefined> {
    let batch = await latestMemoryBackup(this.backupRoot)
    while (batch) {
      batch = await reconcileMemoryBackup(this.backupRoot, this.root, batch)
      if (batch.steps.some((step) => step.outcome !== 'unchanged')) return batch
      batch = await latestMemoryBackup(this.backupRoot)
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

  private protectEntries(
    changes: MemoryFileChange[],
    scope: Map<string, Buffer | null>,
    mode: 'ordinary' | 'clear' | 'recovery'
  ): void {
    const parse = (bytes: Buffer | null) => parseMemoryEntries(bytes === null ? '' : this.decode(bytes))
    const protectedEntries = [...scope.values()]
      .flatMap((bytes) => entriesIn(parse(bytes)))
      .filter((entry) => entry.status !== 'active')
    const blockedSources = new Set(protectedEntries.flatMap((entry) => entry.sources.map(memorySourceKey)))
    const blockedIds = new Set(protectedEntries.map((entry) => entry.id))
    const candidates = [...scope.values(), ...changes.map((change) => change.after)].flatMap((bytes) =>
      entriesIn(parse(bytes))
    )
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
      if (mode === 'clear') {
        after = oldEntries.flatMap((entry) => [forgottenEntry(entry), '\n'])
        if (before.some((part) => typeof part === 'string' && part.trim())) {
          after.push({
            schemaVersion: 1,
            id: randomUUID(),
            status: 'forgotten',
            sources: [],
            text: '',
            derivedFrom: []
          })
        }
      } else if (mode === 'ordinary') {
        if (JSON.stringify(oldEntries) !== JSON.stringify(entriesIn(after))) invalidEntries()
        if (
          protectedEntries.length &&
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
