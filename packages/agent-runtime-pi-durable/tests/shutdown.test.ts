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
import { expect, it } from 'vitest'

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import { runtimeId, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime } from '../src'

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
  let watch = false
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
              return (...[batches, receive, context]: Parameters<Storage['commit']>) =>
                target.commit(
                  batches,
                  (index, seq) => {
                    receive(index, seq)
                    if (watch)
                      for (const write of batches[index])
                        if (
                          write.type === 'submission' &&
                          write.value.type === 'input' &&
                          write.value.status === 'queued'
                        )
                          queued = write.value
                  },
                  context
                )
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
    watch = true
    steering = child.input.submit({ inputId: runtimeId('steer'), text: 'Queued correction', whenBusy: 'steer' })
    await expect.poll(() => queued?.status).toBe('queued')
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
