import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { ProviderDoc, type Tx } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'

import type { ChildSpec, ContractHarness, Key, Step } from '@cherrystudio/agent-behavior'
import type { ThreadId } from '@cherrystudio/agent-runtime'

import { conversationId, threadId } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

const childSpec = (
  boundary: 'foreground' | 'background',
  description: string,
  fork?: ChildSpec['fork']
): ChildSpec => ({
  boundary,
  ...(fork ? { fork } : {}),
  origin: { parentToolCallId: description, fork: Boolean(fork), description, modelKey: 'contract/model' },
  record: {
    parentToolCallId: description,
    description,
    fork: Boolean(fork),
    background: boundary === 'background',
    modelKey: 'contract/model',
    run: 1,
    status: 'running'
  }
})

function spawnChild(harness: ContractHarness, parent: ThreadId, key: string) {
  return harness.withCall(parent, (ports) =>
    ports.ledger.transact(parent, () => ({
      ops: [{ type: 'spawn-child', spec: childSpec('background', key), key: key as Key }],
      effects: [],
      result: null
    }))
  )
}

describe('Durable behavior providerThread cache', () => {
  it('resolves fresh and forked children without full-store conversation scans and attributes child quota', async () => {
    const meterCalls: Array<{ thread: ThreadId; requests: number; role: 'root' | 'child' }> = []
    const h = await openDurableHarness((ports) => {
      ports.requestMeter.register({
        allow: (thread, requests, role) => {
          meterCalls.push({ thread, requests, role })
          return { ok: true }
        }
      })
    })
    const parent = await h.harness.createThread()
    h.harness.script(parent, [{ text: 'parent ready' }])
    await h.harness.sendUser(parent, 'seed parent')
    await h.harness.settle()

    const parentFacts = await h.harness.withCall(parent, (ports) => ports.ledger.read(parent))
    const forkAt = parentFacts.history.findLast((entry) => entry.kind === 'assistant')!.id

    // Instrument native.commit strictly after parent setup, and only measure the child spawn +
    // providerThread lookup + first request window (not settle()'s scanTasks polling).
    const native = h.native()
    const origCommit = native.commit.bind(native)
    let scanConversationsCalls = 0
    let measuring = false
    native.commit = ((call: (tx: Tx) => Promise<unknown>, callContext: typeof context, options?: unknown) =>
      origCommit(
        (tx) =>
          call(
            new Proxy(tx, {
              get(target, prop) {
                const value = Reflect.get(target, prop)
                if (typeof value !== 'function') return value
                if (prop === 'scanConversations') {
                  return (...args: unknown[]) => {
                    if (measuring) scanConversationsCalls++
                    return value.apply(target, args)
                  }
                }
                return value.bind(target)
              }
            })
          ),
        callContext,
        options as never
      )) as typeof native.commit

    meterCalls.length = 0
    measuring = true
    const { spawned: freshSpawn } = await h.harness.withCall(parent, (ports) =>
      ports.ledger.transact(
        parent,
        (): Step<null> => ({
          ops: [{ type: 'spawn-child', spec: childSpec('background', 'fresh-child'), key: 'fresh' as Key }],
          effects: [],
          result: null
        })
      )
    )
    const freshChild = freshSpawn[0].child
    const { spawned: forkSpawn } = await h.harness.withCall(parent, (ports) =>
      ports.ledger.transact(
        parent,
        (): Step<null> => ({
          ops: [
            {
              type: 'spawn-child',
              spec: childSpec('background', 'forked-child', { from: parent, at: forkAt }),
              key: 'forked' as Key
            }
          ],
          effects: [],
          result: null
        })
      )
    )
    const forkedChild = forkSpawn[0].child

    const [parentProvider, freshProvider, forkedProvider] = await Promise.all([
      native.snapshot(ProviderDoc, conversationId(parent), context),
      native.snapshot(ProviderDoc, conversationId(freshChild), context),
      native.snapshot(ProviderDoc, conversationId(forkedChild), context)
    ])
    expect(freshProvider?.sessionId).toBeTruthy()
    expect(forkedProvider?.sessionId).toBeTruthy()
    expect(freshProvider?.sessionId).not.toBe(parentProvider?.sessionId)
    expect(forkedProvider?.sessionId).not.toBe(parentProvider?.sessionId)
    expect(forkedProvider?.sessionId).not.toBe(freshProvider?.sessionId)

    // Verify direct providerThread resolution AND real first model request quota metering hit the cache.
    expect(await h.behavior().providerThread(freshProvider!.sessionId)).toBe(freshChild)
    expect(await h.behavior().providerThread(forkedProvider!.sessionId)).toBe(forkedChild)
    expect(scanConversationsCalls).toBe(0)

    h.harness.script(freshChild, [{ text: 'fresh child answer' }])
    h.harness.script(forkedChild, [{ text: 'forked child answer' }])
    await h.harness.sendUser(freshChild, 'go fresh')
    await h.harness.sendUser(forkedChild, 'go forked')
    await h.harness.settle()
    measuring = false

    expect(scanConversationsCalls).toBe(0)
    expect(meterCalls).toContainEqual({ thread: freshChild, requests: 0, role: 'child' })
    expect(meterCalls).toContainEqual({ thread: forkedChild, requests: 0, role: 'child' })

    const freshFacts = await h.harness.withCall(freshChild, (ports) => ports.ledger.read(freshChild))
    const forkedFacts = await h.harness.withCall(forkedChild, (ports) => ports.ledger.read(forkedChild))
    expect(freshFacts.history.filter((entry) => entry.kind === 'assistant').map((entry) => entry.text)).toEqual([
      'fresh child answer'
    ])
    expect(forkedFacts.history.filter((entry) => entry.kind === 'assistant').map((entry) => entry.text)).toEqual([
      'parent ready',
      'forked child answer'
    ])
    expect(h.errors).toEqual([])
  })

  it('resolves a child lookup started by the commit observer without scanning conversations', async () => {
    const h = await openDurableHarness(() => {})
    const parent = await h.harness.createThread()
    const native = h.native()
    const commit = native.commit.bind(native)
    let scans = 0
    native.commit = (change, ...args) =>
      commit(
        (tx) => {
          const scanConversations = tx.scanConversations.bind(tx)
          tx.scanConversations = (...scanArgs) => {
            scans++
            return scanConversations(...scanArgs)
          }
          return change(tx)
        },
        ...args
      )

    let lookup: Promise<ThreadId> | undefined
    const observer = native.observeCommits({
      advance({ changes }) {
        for (const change of changes) {
          if (
            change.type === 'document' &&
            change.kind === 'change' &&
            change.record.kind === ProviderDoc.definition.kind &&
            change.conversationId !== conversationId(parent) &&
            typeof change.value.sessionId === 'string'
          ) {
            lookup ??= h.behavior().providerThread(change.value.sessionId)
          }
        }
      },
      end() {}
    })
    try {
      const { spawned } = await spawnChild(h.harness, parent, 'observed-child')
      await expect(lookup).resolves.toBe(spawned[0].child)
      expect(scans).toBe(0)
    } finally {
      observer.detach()
    }
  })

  it('discards the child mapping when native settlement fails after the callback returns', async () => {
    let configuredChild: ThreadId | undefined
    const h = await openDurableHarness(() => {}, [], {
      configureChild: (child) => {
        configuredChild = child
        return { model: { provider: `thread-${child}`, modelId: 'faux-1' } }
      }
    })
    const parent = await h.harness.createThread()
    const native = h.native()
    const commit = native.commit.bind(native)
    let failedSessionId: string | undefined
    native.commit = (change, ...args) =>
      commit(
        async (tx) => {
          const result = await change(tx)
          if (configuredChild && !failedSessionId) {
            const id = conversationId(configuredChild)
            failedSessionId = (await tx.doc(ProviderDoc, id)).sessionId
            // Native settlement rejects a callback that leaves a Tx operation pending.
            void tx.appendEntry(id, { kind: 'pi.user' }).catch(() => {})
          }
          return result
        },
        ...args
      )

    await expect(spawnChild(h.harness, parent, 'doomed-at-settlement')).rejects.toThrow(
      'Session commit callback settled before its pending Tx operations'
    )
    expect(failedSessionId).toBeTruthy()
    await expect(h.behavior().providerThread(failedSessionId!)).rejects.toThrow('Unknown Durable provider session')

    const { spawned } = await spawnChild(h.harness, parent, 'committed-child')
    const child = spawned[0].child
    const provider = await native.snapshot(ProviderDoc, conversationId(child), context)
    expect(provider?.sessionId).toBeTruthy()
    await expect(h.behavior().providerThread(provider!.sessionId)).resolves.toBe(child)
    await expect(h.behavior().providerThread(failedSessionId!)).rejects.toThrow('Unknown Durable provider session')
  })

  it('does not publish a provider mapping when the spawn-child transaction fails', async () => {
    let failChildConfig = false
    const h = await openDurableHarness(() => {}, [], {
      configureChild: (child) => {
        if (failChildConfig) throw new Error('configure child failed')
        return { model: { provider: `thread-${child}`, modelId: 'faux-1' } }
      }
    })
    const parent = await h.harness.createThread()
    const native = h.native()
    const origCommit = native.commit.bind(native)
    let stagedChildSessionId: string | undefined

    native.commit = ((call: (tx: Tx) => Promise<unknown>, callContext: typeof context, options?: unknown) =>
      origCommit(
        (tx) =>
          call(
            new Proxy(tx, {
              get(target, prop) {
                const value = Reflect.get(target, prop)
                if (typeof value !== 'function') return value
                if (prop === 'createConversation') {
                  return async (...args: unknown[]) => {
                    const record = await value.apply(target, args)
                    if (failChildConfig && record && typeof record === 'object' && 'id' in record) {
                      const doc = await target.doc(
                        ProviderDoc,
                        (record as { id: ReturnType<typeof conversationId> }).id
                      )
                      if (typeof doc?.sessionId === 'string') stagedChildSessionId = doc.sessionId
                    }
                    return record
                  }
                }
                return value.bind(target)
              }
            })
          ),
        callContext,
        options as never
      )) as typeof native.commit

    failChildConfig = true
    await expect(
      h.harness.withCall(parent, (ports) =>
        ports.ledger.transact(
          parent,
          (): Step<null> => ({
            ops: [{ type: 'spawn-child', spec: childSpec('background', 'doomed-child'), key: 'doomed' as Key }],
            effects: [],
            result: null
          })
        )
      )
    ).rejects.toThrow('configure child failed')

    expect(stagedChildSessionId).toBeTruthy()
    await expect(h.behavior().providerThread(stagedChildSessionId!)).rejects.toThrow('Unknown Durable provider session')
  })

  it('keeps fallback resolution for unwarmed conversations after restart and rejects unknown sessions', async () => {
    const h = await openDurableHarness(() => {})
    const native = h.native()
    const uncached = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
    const provider = await native.snapshot(ProviderDoc, uncached.id, context)
    expect(provider?.sessionId).toBeTruthy()

    await h.harness.restart()

    expect(await h.behavior().providerThread(provider!.sessionId)).toBe(threadId(uncached.id))
    await expect(h.behavior().providerThread('non-existent-provider-session')).rejects.toThrow(
      'Unknown Durable provider session'
    )
  })

  it('warms provider cache for created root conversations and ownerless forks without scanning', async () => {
    const h = await openDurableHarness(() => {})
    const parent = await h.harness.createThread()
    h.harness.script(parent, [{ text: 'parent ready' }])
    await h.harness.sendUser(parent, 'seed parent')
    await h.harness.settle()

    const parentFacts = await h.harness.withCall(parent, (ports) => ports.ledger.read(parent))
    const forkAt = parentFacts.history.findLast((entry) => entry.kind === 'assistant')!.id

    const native = h.native()
    const origCommit = native.commit.bind(native)
    let scanConversationsCalls = 0
    let measuring = false
    native.commit = ((call: (tx: Tx) => Promise<unknown>, callContext: typeof context, options?: unknown) =>
      origCommit(
        (tx) =>
          call(
            new Proxy(tx, {
              get(target, prop) {
                const value = Reflect.get(target, prop)
                if (typeof value !== 'function') return value
                if (prop === 'scanConversations') {
                  return (...args: unknown[]) => {
                    if (measuring) scanConversationsCalls++
                    return value.apply(target, args)
                  }
                }
                return value.bind(target)
              }
            })
          ),
        callContext,
        options as never
      )) as typeof native.commit

    measuring = true
    const created = await native.createConversation({ ownership: { kind: 'ownerless' } }, context)
    const forked = await native.commit(
      (tx) =>
        tx.forkConversation(conversationId(parent), Number(forkAt) as never, { ownership: { kind: 'ownerless' } }),
      context
    )
    const [createdProvider, forkedProvider] = await Promise.all([
      native.snapshot(ProviderDoc, created.id, context),
      native.snapshot(ProviderDoc, forked.id, context)
    ])
    expect(createdProvider?.sessionId).toBeTruthy()
    expect(forkedProvider?.sessionId).toBeTruthy()

    expect(await h.behavior().providerThread(createdProvider!.sessionId)).toBe(threadId(created.id))
    expect(await h.behavior().providerThread(forkedProvider!.sessionId)).toBe(threadId(forked.id))
    expect(scanConversationsCalls).toBe(0)
    measuring = false
  })
})
