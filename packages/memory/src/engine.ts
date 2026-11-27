import { Mutex } from 'async-mutex'

import { DREAMING_INSTRUCTIONS, fitDreamingInputs, prepareDreamingPlan } from './dreaming'
import { extractAndSave, prepareExtraction } from './extract-and-save'
import type { MemoryModel, ConversationMessage } from './extraction'
import { MEMORY_ENTRY, MEMORY_WARNING_BYTES, MEMORY_WARNING_LINES, utf8Length, memoryLineCount } from './files'
import { automaticWindow, ExtractionQueue, type ExtractionProgress, type MemoryStateStore, type TurnRef } from './queue'
import type { MemoryStorage, MemoryBackupStorage } from './storage'
import {
  MemoryStore,
  type MemoryAccess,
  type MemoryApproval,
  type MemoryCommitResult,
  type MemoryMutation
} from './store'

export interface ScopedAccess extends MemoryAccess {
  readonly scope: string
  readonly owner: string
  readonly conversationId: string
  readonly kind: 'chat' | 'agent'
}
export interface ExtractionRange {
  fromUserId: string
  throughResponseId: string
}
export interface MemoryConversationSource {
  /** Synchronously attest that the transcript is fresh or isolated from prior memory. */
  isHistoryIsolated?(access: ScopedAccess): boolean
  /** Return the contiguous selected ancestry between both endpoints while extraction is authorized. */
  range?(access: ScopedAccess, range: ExtractionRange): ReturnType<MemoryConversationSource['window']>

  /** Return the authorized selected ancestry ending at the fixed batch endpoint. Missing or invalid turns occupy null slots. */
  window(
    access: ScopedAccess,
    turns: readonly TurnRef[]
  ): Promise<{
    turns: ({ user: ConversationMessage; reply: ConversationMessage } | null)[]
    hash: string
    timeZone: string
    validate(): Promise<void>
    assertCurrent(): void
  }>
}
interface OrganizationState {
  files?: Record<string, { hash?: string | null; count: number; first: number }>
  revision: number
  retryAt: number
  attempts: number
  epoch?: number
  historyIntent?: { id: string; files: { path: string; before: string | null }[] }
  modelId?: string
  blocked?: Record<string, string | null>
  processed?: Record<string, string | null>
}
export interface MemoryEnginePorts {
  scope(key: string): { storage: MemoryStorage; backup: MemoryBackupStorage }
  extraction: MemoryStateStore<ExtractionProgress>
  organization: MemoryStateStore<OrganizationState>
  context: MemoryStateStore<{ fingerprint: string | null; unobserved?: true }>
  conversations: MemoryConversationSource
  model(access: ScopedAccess): Promise<MemoryModel>
  now(): number
}

function matchesTurn(pair: { user: ConversationMessage; reply: ConversationMessage }, ref: TurnRef | undefined) {
  return (
    ref &&
    pair.user.role === 'user' &&
    pair.reply.role === 'assistant' &&
    pair.reply.id === ref.responseId &&
    pair.user.version === ref.inputVersion &&
    pair.reply.version === ref.responseVersion
  )
}

export function createMemoryEngine(ports: MemoryEnginePorts) {
  const stores = new Map<string, MemoryStore>()
  const queue = new ExtractionQueue(ports.extraction, () => ports.now())
  const worker = new Mutex()
  const invalid = new Map<string, number>()
  const contexts = new Map<
    string,
    { scope: string; revision: string; entry: Promise<{ content: string; truncated: boolean }> }
  >()
  let active: { scope: string; controller: AbortController } | undefined
  let paused = false,
    disposed = false
  const initial = (): OrganizationState => ({ revision: 0, retryAt: 0, attempts: 0 })
  function invalidate(scope: string) {
    invalid.set(scope, (invalid.get(scope) ?? 0) + 1)
    if (active?.scope === scope) active.controller.abort()
    stores.get(scope)?.invalidate()
    for (const [key, context] of contexts) if (context.scope === scope) contexts.delete(key)
  }
  function open(access: ScopedAccess) {
    access.assertAuthorized()
    if (paused || disposed) throw Error('Memory engine is paused')
    const generation = invalid.get(access.scope) ?? 0
    const guard = {
      assertAuthorized(): undefined {
        access.assertAuthorized()
        if (paused || disposed || generation !== (invalid.get(access.scope) ?? 0)) throw Error('Memory session expired')
        return undefined
      }
    }
    const backend = ports.scope(access.scope)
    let instance = stores.get(access.scope)
    if (!instance) {
      instance = new MemoryStore(backend.storage, backend.backup, undefined, async (id, changes) => {
        await reconcileHistory()
        if (!changes.length) {
          await ports.organization.update(access.scope, (old) => {
            const state = old ?? initial()
            state.epoch = (state.epoch ?? 0) + 1
            return { state, value: undefined }
          })
          invalidate(access.scope)
          return
        }
        await ports.organization.update(access.scope, (old) => {
          const state = old ?? initial()
          state.historyIntent = {
            id,
            files: changes.map((c) => ({
              path: c.path,
              before: c.before === null ? null : backend.backup.sha256(c.before)
            }))
          }
          return { state, value: undefined }
        })
      })
      stores.set(access.scope, instance)
    }
    const store = instance
    const key = JSON.stringify([access.scope, access.owner, access.conversationId])
    async function reconcileHistory() {
      const pending = await ports.organization.update(access.scope, (old) => ({
        state: old ?? initial(),
        value: old?.historyIntent
      }))
      let changedHistory = false
      if (pending)
        for (const file of pending.files) {
          const bytes = await backend.storage.read(file.path, 20 * 1024 * 1024)
          if ((bytes === null ? null : backend.backup.sha256(bytes)) !== file.before) {
            changedHistory = true
            break
          }
        }
      const epoch = await ports.organization.update(access.scope, (old) => {
        const state = old ?? initial()
        if (pending && state.historyIntent?.id === pending.id) {
          if (changedHistory) {
            state.epoch = (state.epoch ?? 0) + 1
          }
          delete state.historyIntent
        }
        return { state, value: state.epoch ?? 0 }
      })
      return epoch
    }
    async function queueKey() {
      const epoch = await store.inspectHistory(reconcileHistory)
      guard.assertAuthorized()
      return JSON.stringify([key, epoch])
    }
    const changed = async (result: MemoryCommitResult) => {
      if (result.files.some((f) => f.outcome === 'applied'))
        await ports.organization.update(access.scope, (old) => {
          const s = old ?? initial()
          s.files ??= {}
          for (const file of result.files) {
            if (file.outcome !== 'applied') continue
            const pending = (s.files[file.path] ??= { count: 0, first: ports.now() })
            pending.count++
            pending.hash = file.hash
          }
          s.revision++
          s.attempts = 0
          s.retryAt = 0
          return { state: s, value: undefined }
        })
      return result
    }
    async function context() {
      guard.assertAuthorized()
      let fingerprint: string | null = null
      let revision = ''
      await store.assertRuntimeSafe(guard, (f, r) => {
        revision = r
        fingerprint = f
      })
      const historyKey = JSON.stringify(['history', access.kind, access.scope, access.conversationId])
      const legacy = await ports.context.update(key, (old) => ({
        state: old ?? { fingerprint: null, unobserved: true },
        value: old?.unobserved ? undefined : old
      }))
      await ports.context.update(historyKey, (old) => {
        guard.assertAuthorized()
        const previous = old ?? legacy
        if (
          previous
            ? previous.fingerprint !== fingerprint
            : fingerprint !== null && !ports.conversations.isHistoryIsolated?.(access)
        )
          throw Error('Conversation memory protection changed')
        return { state: old ?? { fingerprint }, value: undefined }
      })

      let cached = contexts.get(key)
      if (!cached || cached.revision !== revision) {
        cached = { scope: access.scope, revision, entry: store.entry(guard) }
        contexts.set(key, cached)
      }
      try {
        return await store.inspectHistory(async () => {
          const result = await cached.entry
          await store.assertRuntimeSafe(guard, (current, revisions) => {
            if (current !== fingerprint || revision !== revisions) throw Error('Conversation memory protection changed')
          })
          guard.assertAuthorized()
          return result
        })
      } catch (error) {
        if (contexts.get(key) === cached) contexts.delete(key)
        throw error
      }
    }
    async function previewExtraction(range: ExtractionRange) {
      if (access.scope !== 'shared' || !ports.conversations.range) throw Error('Extraction preview unavailable')
      const readRange = ports.conversations.range.bind(ports.conversations)
      return worker.runExclusive(async () => {
        guard.assertAuthorized()
        const controller = new AbortController()
        active = { scope: access.scope, controller }
        try {
          const progressKey = await queueKey()
          const admitted = await queue.admissions(progressKey)
          const refs = new Map(admitted.turns.map((t) => [t.userId, t]))
          const source = await readRange(access, range)
          if (
            !source.turns.length ||
            source.turns[0]?.user.id !== range.fromUserId ||
            source.turns.at(-1)?.reply.id !== range.throughResponseId
          )
            throw Error('Invalid extraction range')
          const messages: ConversationMessage[] = []
          let bytes = 0
          for (const pair of source.turns) {
            if (!pair || !matchesTurn(pair, refs.get(pair.user.id))) throw Error('Range contains an unadmitted turn')
            refs.delete(pair.user.id)
            messages.push(pair.user)
            if (pair.reply.id !== range.throughResponseId) messages.push(pair.reply)
          }
          for (const message of messages) {
            const size = utf8Length(message.text)
            bytes += size
            if (size > 8000 || bytes > 64000) throw Error('Extraction range exceeds budget')
          }
          const validate = async () => {
            guard.assertAuthorized()
            controller.signal.throwIfAborted()
            await queue.check(progressKey, admitted.generation)
            await source.validate()
            source.assertCurrent()
          }
          const prepared = await prepareExtraction(
            store,
            guard,
            { ...source, messages, kind: access.kind, conversationId: access.conversationId },
            await ports.model(access),
            controller.signal,
            validate
          )
          return await store.inspectHistory(async () => {
            await prepared.current()
            source.assertCurrent()
            controller.signal.throwIfAborted()
            guard.assertAuthorized()
            return prepared.proposal
          })
        } finally {
          active = undefined
        }
      })
    }
    async function maintain(options: { extraction: boolean; organization: boolean }) {
      if (worker.isLocked()) return 'busy'
      return worker.runExclusive(async () => {
        guard.assertAuthorized()
        const controller = new AbortController()
        active = { scope: access.scope, controller }
        const signal = controller.signal
        const check = () => {
          guard.assertAuthorized()
          signal.throwIfAborted()
          return undefined
        }
        try {
          const progressKey = await queueKey()
          const due = options.extraction && access.scope === 'shared' ? await queue.due(progressKey) : undefined
          if (due) {
            try {
              const source = await ports.conversations.window(access, [...due.ancestors, ...due.turns])
              const applied: NonNullable<ExtractionProgress['intent']> = []
              const remaining = new Set<string>()
              for (const file of due.intent ?? []) {
                const hash = (await store.read(guard, file.path)).hash
                if (hash === file.after) applied.push(file)
                else if (hash === file.before) remaining.add(file.path)
                else {
                  await queue.finish(progressKey, due.generation, due.end)
                  return 'conflict'
                }
              }
              if (applied.length && (due.sourceHash !== source.hash || !remaining.size)) {
                await queue.finish(progressKey, due.generation, due.end)
                return due.sourceHash === source.hash ? 'recovered' : 'conflict'
              }
              const expected = new Map([...due.ancestors, ...due.turns].map((turn) => [turn.userId, turn]))
              const window = automaticWindow(
                source.turns.map((pair) => {
                  if (!pair) return null
                  const ref = expected.get(pair.user.id)
                  return matchesTurn(pair, ref) ? pair : null
                })
              )
              if (!window.messages.some((m) => m.id === due.end && m.role === 'user')) {
                await source.validate()
                check()
                source.assertCurrent()
                await queue.skipEndpoint(progressKey, due.generation, due.end)
                return 'skipped'
              }
              const processed = new Set(window.messages.filter((m) => m.role === 'user').map((m) => m.id))
              const verify = async () => {
                check()
                await queue.check(progressKey, due.generation)
                await source.validate()
                check()
              }
              const { result } = await extractAndSave(
                store,
                guard,
                {
                  ...window,
                  hash: source.hash,
                  timeZone: source.timeZone,
                  kind: access.kind,
                  conversationId: access.conversationId
                },
                await ports.model(access),
                signal,
                verify,
                async (changes) => {
                  if (
                    applied.length &&
                    (changes.length !== remaining.size || changes.some((f) => !remaining.has(f.path)))
                  )
                    throw Error('Partial extraction proposal changed')
                  if (
                    due.intent?.some(
                      (file) =>
                        remaining.has(file.path) &&
                        changes.find((c) => c.path === file.path)?.expectedHash !== file.before
                    )
                  )
                    throw Error('Prepared file changed before resuming')
                  await queue.prepare(
                    progressKey,
                    due.generation,
                    source.hash,
                    [
                      ...applied,
                      ...changes.map((f) => ({
                        path: f.path,
                        before: f.expectedHash,
                        after: f.content === null ? null : backend.backup.sha256(new TextEncoder().encode(f.content))
                      }))
                    ],
                    processed
                  )
                  return () => {
                    source.assertCurrent()
                    return check()
                  }
                },
                applied
              )
              if (applied.length && remaining.size && !result) throw Error('Partial extraction remains pending')
              if (result?.error) throw Error(result.error)
              if (result) await changed(result)
              await queue.finish(progressKey, due.generation, due.end, processed)
              return 'extracted'
            } catch (error) {
              if (!signal.aborted) await queue.defer(progressKey, due.generation)
              throw error
            }
          }
          if (!options.organization) return 'idle'
          const snapshot = await store.organizationFiles(guard)
          const paths = snapshot.map((f) => f.path)
          const reads = [
            snapshot.find((f) => f.path === MEMORY_ENTRY) ?? {
              path: MEMORY_ENTRY,
              content: null,
              hash: null,
              receipt: ''
            },
            ...snapshot.filter((f) => f.path !== MEMORY_ENTRY)
          ]
          const state = await ports.organization.update(access.scope, (old) => {
            const s = old ?? initial()
            s.files ??= {}
            for (const f of reads) {
              if (f.hash === null || (s.processed?.[f.path] === f.hash && !s.files[f.path]?.count)) {
                delete s.files[f.path]
                continue
              }
              const pending = (s.files[f.path] ??= { count: 0, first: ports.now() })
              if (pending.hash !== f.hash) {
                pending.hash = f.hash
                s.retryAt = 0
                s.attempts = 0
                if (s.blocked) delete s.blocked[f.path]
              }
            }
            for (const path of Object.keys(s.files)) if (!paths.includes(path)) delete s.files[path]
            return { state: s, value: s }
          })
          const dueFiles = reads.filter((f) => {
            const pending = state.files?.[f.path]
            return (
              pending &&
              (pending.count >= 10 ||
                ports.now() - pending.first >= 7 * 86400000 ||
                utf8Length(f.content ?? '') >= MEMORY_WARNING_BYTES ||
                (f.path === MEMORY_ENTRY && memoryLineCount(f.content ?? '') >= MEMORY_WARNING_LINES))
            )
          })
          if (!dueFiles.length) return 'idle'
          const model = await ports.model(access)
          const modelChanged = state.modelId !== model.id
          if (!modelChanged && (ports.now() < state.retryAt || state.attempts >= 2)) return 'idle'
          const eligible = dueFiles.filter((f) => modelChanged || state.blocked?.[f.path] !== f.hash)
          if (!eligible.length) return 'idle'
          try {
            const topics = eligible.filter((f) => f.path !== MEMORY_ENTRY)
            const batch = fitDreamingInputs([reads[0], ...topics].slice(0, 10), model)
            for (const file of batch.inputs) {
              const checked = await store.modelRead(guard, file.path, 'current', undefined, true)
              if (checked.hash !== file.hash || checked.content !== file.content)
                throw Error('Organization snapshot changed')
              file.receipt = checked.receipt
            }
            if (batch.inputs.some((f) => !f.receipt)) throw Error('Memory is protected')
            check()
            const output = await model.generate({
              system: DREAMING_INSTRUCTIONS,
              prompt: batch.prompt,
              maxOutputTokens: batch.outputTokens,
              signal
            })
            check()
            if (output.finishReason !== 'stop' || utf8Length(output.text) > 550000)
              throw Error('Invalid organization output')
            const plan = await prepareDreamingPlan(output.text, batch.inputs, paths, {
              read: (p) => store.read(guard, p)
            })
            const result = await store.commit(guard, plan.mutations, 'dreaming', async () => check, {
              readReceipts: batch.inputs.map((f) => f.receipt),
              clearTargets: paths
            })
            if (result.error) throw Error(result.error)
            await ports.organization.update(access.scope, (old) => {
              const s = old ?? initial()
              if (s.revision === state.revision) {
                s.processed ??= {}
                if (modelChanged) s.blocked = {}
                s.blocked ??= {}
                s.modelId = model.id
                for (const file of batch.unfit) s.blocked[file.path] = file.hash
                for (const f of batch.inputs) {
                  const outcome = result.files.find((item) => item.path === f.path)
                  s.processed[f.path] = outcome ? outcome.hash : f.hash
                  if (s.files) delete s.files[f.path]
                }
                s.attempts = 0
                s.retryAt = 0
              }
              return { state: s, value: undefined }
            })
            return 'organized'
          } catch (error) {
            if (!signal.aborted)
              await ports.organization.update(access.scope, (old) => {
                const s = old ?? initial()
                if (s.revision === state.revision) {
                  s.attempts = modelChanged ? 1 : s.attempts + 1
                  s.modelId = model.id
                  s.retryAt = ports.now() + 600000
                }
                return { state: s, value: undefined }
              })
            throw error
          }
        } finally {
          active = undefined
        }
      })
    }
    function forgetWork() {
      invalidate(access.scope)
    }
    return {
      context,
      previewExtraction,
      read: (p: string) => store.read(guard, p),
      entry: () => store.entry(guard),
      modelRead: (p: string) => store.modelRead(guard, p),
      commit: async (m: readonly MemoryMutation[], approval: MemoryApproval) =>
        changed(await store.commit(guard, m, 'controlled', approval)),
      previewClear: () => store.previewClear(guard),
      clear: async (token: string, approval: MemoryApproval) => {
        const result = await store.clear(guard, token, approval)
        if (!result.error || result.files.some((f) => f.outcome === 'applied')) forgetWork()
        return result
      },
      previewRecovery: () => store.previewRecovery(guard),
      recover: async (token: string, approval: MemoryApproval) => {
        const result = await store.recover(guard, token, approval)
        if (result.files.some((f) => f.outcome === 'applied')) forgetWork()
        return result
      },
      recordSubmission: async (id: string, v: string) => {
        guard.assertAuthorized()
        if (access.scope !== 'shared') throw Error('Automatic extraction requires shared access')
        return queue.recordSubmission(await queueKey(), id, v)
      },
      admit: async (t: TurnRef, selected: ReadonlySet<string>) => {
        guard.assertAuthorized()
        if (access.scope !== 'shared') return false
        return queue.admit(await queueKey(), t, selected)
      },
      runMaintenance: maintain,
      invalidate: async () => {
        guard.assertAuthorized()
        forgetWork()
        await ports.organization.update(access.scope, (old) => {
          const state = old ?? initial()
          state.epoch = (state.epoch ?? 0) + 1
          return { state, value: undefined }
        })
        await store.drain()
      }
    }
  }
  const inFlight = new Set<Promise<unknown>>()
  async function drain() {
    while (inFlight.size) await Promise.allSettled([...inFlight])
    await worker.waitForUnlock()
    await Promise.all([...stores.values()].map((store) => store.drain()))
    if (disposed) {
      stores.clear()
      contexts.clear()
    }
  }
  return {
    open(access: ScopedAccess) {
      const session = open(access)
      return new Proxy(session, {
        get(target, key: keyof typeof session) {
          if (!Object.hasOwn(target, key)) return Reflect.get(target, key)
          return (...args: unknown[]) => {
            const promise = Reflect.apply(target[key], target, args) as Promise<unknown>
            inFlight.add(promise)
            return promise.finally(() => inFlight.delete(promise))
          }
        }
      })
    },
    invalidate: async (scope: string) => {
      invalidate(scope)
      await ports.organization.update(scope, (old) => {
        const state = old ?? initial()
        state.epoch = (state.epoch ?? 0) + 1
        return { state, value: undefined }
      })
    },
    interrupt: () => active?.controller.abort(),
    pause() {
      paused = true
      for (const key of stores.keys()) invalidate(key)
    },
    resume() {
      paused = false
    },
    drain,
    dispose() {
      disposed = true
      active?.controller.abort()
      for (const store of stores.values()) store.invalidate()
      return drain()
    }
  }
}
