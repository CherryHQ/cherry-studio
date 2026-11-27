import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { awaitWithContext, BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep
} from '@earendil-works/pi-ai'
import { createRegistry, type Storage, type SubmissionRecord } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it, vi } from 'vitest'

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import { runtimeId, type OperationResult, type ProductInputState, type Thread } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime, readDurableInput } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

it('closes a blocked shared-behavior child with an admitted steer without cancelling or resubmitting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-close-'))
  const file = join(directory, 'store.sqlite')
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  let unblock!: () => void
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let childStarted = false
  let parentRequests = 0
  let childThread: Thread | undefined
  let intent: ProductInputState | undefined
  let queued: SubmissionRecord | undefined
  const step: FauxResponseStep = async (context, options) => {
    const input = context.messages.findLast((message) => message.role === 'user')
    if (input?.role === 'user' && typeof input.content === 'string' && input.content.includes('BLOCK_CHILD')) {
      childStarted = true
      await awaitWithContext(blocked, withAbortSignal(options!.signal!, BACKGROUND_CONTEXT))
      return fauxAssistantMessage('child done')
    }
    return parentRequests++ === 0
      ? fauxAssistantMessage(
          fauxToolCall(
            'subagent',
            { description: 'Blocked child', prompt: 'BLOCK_CHILD', background: true },
            { id: 'spawn' }
          ),
          { stopReason: 'toolUse' }
        )
      : fauxAssistantMessage('parent done')
  }
  faux.setResponses(Array.from({ length: 20 }, () => step))
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('shutdown'),
      async openStorage() {
        const storage = await openNodeSqliteStorage(file)
        return new Proxy(storage, {
          get(target, key) {
            if (key === 'commit')
              return async (...[batches, receive, context]: Parameters<Storage['commit']>) => {
                const admission =
                  childThread &&
                  batches
                    .flat()
                    .find(
                      (write) =>
                        write.type === 'submission' && write.value.type === 'input' && write.value.status === 'queued'
                    )
                if (admission?.type === 'submission' && childThread) {
                  intent = await readDurableInput(target, childThread, runtimeId('steer'))
                }
                const result = await target.commit(batches, receive, context)
                if (admission?.type === 'submission') queued = admission.value
                return result
              }
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
      },
      harness: { models, registry: createRegistry() },
      behavior: {
        host: createScriptedHost({
          settings: {
            goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
            autonomy: 'auto',
            permissionMode: 'bypassPermissions',
            attendance: 'stream',
            maxBackground: 2,
            offloadThreshold: 4000
          }
        }),
        configureChild: () => ({ model: { provider: 'faux', modelId: 'faux-1' } })
      }
    })
  )
  let steering: Promise<unknown> | undefined
  try {
    const root = confirmed(
      await runtime.create({
        ownership: { kind: 'ownerless' },
        agent: { model: { provider: 'faux', modelId: 'faux-1' } }
      })
    )
    confirmed(await runtime.resume())
    await root.input.submit({ inputId: runtimeId('root'), text: 'Start a child', whenBusy: 'reject' })
    await expect.poll(() => childStarted).toBe(true)
    const child = confirmed(await root.durable.openChild('spawn')).handle
    childThread = child.thread
    steering = child.input.submit({ inputId: runtimeId('steer'), text: 'Queued correction', whenBusy: 'steer' })
    await expect.poll(() => queued?.status).toBe('queued')
    expect(intent).toEqual({ inputId: 'steer', facts: ['dispatch-started'] })
    const accepted = queued!
    let ended: OperationResult<void> | undefined
    const closing = runtime.shutdown().then((result) => {
      ended = result
      return result
    })
    try {
      await expect.poll(() => ended?.status, { timeout: 1500 }).toBe('confirmed')
    } finally {
      unblock()
      await closing
      await steering
    }
    const storage = await openNodeSqliteStorage(file)
    try {
      expect(await readDurableInput(storage, child.thread, runtimeId('steer'))).toMatchObject({
        inputId: 'steer',
        nativeInput: { session: child.thread, id: String(accepted.id) },
        facts: ['accepted', 'queued']
      })
      expect(await readDurableInput(storage, root.thread, runtimeId('steer'))).toBeUndefined()
      const saved = await storage.scanSubmissions(
        { conversationId: accepted.conversationId },
        256,
        undefined,
        BACKGROUND_CONTEXT
      )
      expect(saved.items.filter((record) => record.requestId === accepted.requestId)).toHaveLength(1)
      expect(saved.items.find((record) => record.id === accepted.id)).toMatchObject({ type: 'input', status: 'queued' })
    } finally {
      await storage.close(BACKGROUND_CONTEXT)
    }
  } finally {
    unblock()
    await runtime.shutdown()
    await steering
    await rm(directory, { recursive: true, force: true })
  }
})

it('completes native close, registry teardown, and commit observer end when behavior close fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-shutdown-fail-'))
  const file = join(directory, 'store.sqlite')
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  const stopRegistrySpy = vi.fn()
  const origSubscribe = registry.subscribe.bind(registry)
  vi.spyOn(registry, 'subscribe').mockImplementation((listener) => {
    const unsub = origSubscribe(listener)
    return () => {
      stopRegistrySpy()
      unsub()
    }
  })

  let storage!: Storage
  let closeStorageSpy!: ReturnType<typeof vi.spyOn>
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('shutdown-fail'),
      async openStorage() {
        storage = await openNodeSqliteStorage(file)
        closeStorageSpy = vi.spyOn(storage, 'close')
        return storage
      },
      harness: { models, registry },
      behavior: {
        host: createScriptedHost({
          settings: {
            goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
            autonomy: 'auto',
            permissionMode: 'bypassPermissions',
            attendance: 'stream',
            maxBackground: 2,
            offloadThreshold: 4000
          }
        }),
        configureChild: () => ({ model: { provider: 'faux', modelId: 'faux-1' } })
      }
    })
  )

  let commitEnded = false
  const commitObserver = runtime.durable.observeCommits({
    advance() {},
    end() {
      commitEnded = true
    }
  })

  try {
    confirmed(
      await runtime.create({
        ownership: { kind: 'ownerless' },
        agent: { model: { provider: 'faux', modelId: 'faux-1' } }
      })
    )
    vi.spyOn(storage, 'scanConversations').mockRejectedValueOnce(new Error('storage failed'))
    await expect(runtime.durable.commit((tx) => tx.scanConversations({}, 1), BACKGROUND_CONTEXT)).rejects.toThrow(
      'storage failed'
    )

    const result = await runtime.shutdown()
    expect(result).toMatchObject({ status: 'unknown' })
    expect(closeStorageSpy).toHaveBeenCalledTimes(1)
    expect(stopRegistrySpy).toHaveBeenCalledTimes(1)
    expect(commitEnded).toBe(true)
  } finally {
    commitObserver.detach()
    await runtime.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
