import type { KnowledgeBase, KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeQueueManager } from '../KnowledgeQueueManager'
import type {
  EnqueueKnowledgeTaskOptions,
  IndexLeafTaskEntry,
  KnowledgeQueueTaskDescriptor,
  PrepareRootTaskEntry
} from '../types'

const { loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: loggerErrorMock,
      info: vi.fn(),
      warn: loggerWarnMock
    })
  }
}))

const BASE_ID = 'base-1'
const BASE: KnowledgeBase = {
  id: BASE_ID,
  name: 'Base',
  groupId: null,
  emoji: '📁',
  dimensions: 1024,
  embeddingModelId: 'ollama::nomic-embed-text',
  status: 'completed',
  error: null,
  chunkSize: 1024,
  chunkOverlap: 200,
  searchMode: 'hybrid',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
}

function createNoteItem(
  id = 'note-1',
  status: KnowledgeItem['status'] = 'processing',
  baseId = BASE_ID
): KnowledgeItemOf<'note'> {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId,
    groupId: null,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(
  id = 'dir-1',
  status: KnowledgeItem['status'] = 'processing',
  baseId = BASE_ID
): KnowledgeItemOf<'directory'> {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId,
    groupId: null,
    type: 'directory',
    data: { source: `/docs/${id}`, path: `/docs/${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createIndexTask(
  itemId: string,
  execute: EnqueueKnowledgeTaskOptions<IndexLeafTaskEntry>['execute'],
  baseId = BASE_ID
): EnqueueKnowledgeTaskOptions<IndexLeafTaskEntry> {
  return {
    base: { ...BASE, id: baseId },
    kind: 'index-leaf',
    item: createNoteItem(itemId, 'processing', baseId),
    execute
  }
}

function createPrepareTask(
  itemId: string,
  execute: EnqueueKnowledgeTaskOptions<PrepareRootTaskEntry>['execute'],
  baseId = BASE_ID
): EnqueueKnowledgeTaskOptions<PrepareRootTaskEntry> {
  return {
    base: { ...BASE, id: baseId },
    kind: 'prepare-root',
    item: createDirectoryItem(itemId, 'processing', baseId),
    execute
  }
}

function createTaskDescriptor(
  itemId: string,
  kind: KnowledgeQueueTaskDescriptor['kind'] = 'index-leaf',
  baseId = BASE_ID
): KnowledgeQueueTaskDescriptor {
  return {
    base: { ...BASE, id: baseId },
    baseId,
    itemId,
    itemType: kind === 'index-leaf' ? 'note' : 'directory',
    kind
  }
}

function captureError<T>(promise: Promise<T>): Promise<Error> {
  return promise.then(
    () => new Error('Expected promise to reject'),
    (error) => (error instanceof Error ? error : new Error(String(error)))
  )
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('KnowledgeQueueManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates queued work for the same item', async () => {
    const manager = new KnowledgeQueueManager()
    const execute = vi.fn(async () => undefined)

    const firstPromise = manager.enqueue(createIndexTask('item-1', execute))
    const secondPromise = manager.enqueue(createIndexTask('item-1', execute))

    expect(secondPromise).toBe(firstPromise)
    await expect(firstPromise).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot()).toEqual({ pending: [], running: [] })
  })

  it('preserves task kind in snapshots and interrupted entries', async () => {
    const manager = new KnowledgeQueueManager()
    const blocker = createDeferred()
    const started = createDeferred()

    const taskPromise = manager.enqueue(
      createPrepareTask('dir-1', async () => {
        started.resolve()
        await blocker.promise
      })
    )
    const taskError = captureError(taskPromise)

    await started.promise

    expect(manager.getSnapshot().running).toEqual([createTaskDescriptor('dir-1', 'prepare-root')])
    expect(manager.interruptItems(['dir-1'], 'deleted')).toEqual([createTaskDescriptor('dir-1', 'prepare-root')])

    blocker.resolve()
    await expect(taskError).resolves.toMatchObject({ message: 'deleted' })
  })

  it('rejects pending tasks on interrupt and does not execute them later', async () => {
    const manager = new KnowledgeQueueManager()
    const blockers = Array.from({ length: 5 }, () => createDeferred())
    const executedItemIds: string[] = []

    const runningPromises = blockers.map((deferred, index) =>
      manager.enqueue(
        createIndexTask(`running-${index}`, async (context) => {
          executedItemIds.push(context.itemId)
          await deferred.promise
        })
      )
    )

    await vi.waitFor(() => {
      expect(executedItemIds).toHaveLength(5)
    })

    const pendingPromise = manager.enqueue(
      createIndexTask('pending', async (context) => {
        executedItemIds.push(context.itemId)
      })
    )
    const pendingError = captureError(pendingPromise)

    expect(manager.getSnapshot().pending).toEqual([createTaskDescriptor('pending')])

    const interruptedEntries = manager.interruptItems(['pending'], 'deleted')

    expect(interruptedEntries).toEqual([createTaskDescriptor('pending')])
    await expect(pendingError).resolves.toMatchObject({ message: 'deleted' })
    expect(manager.getSnapshot().pending).toEqual([])

    for (const blocker of blockers) {
      blocker.resolve()
    }

    await expect(Promise.all(runningPromises)).resolves.toEqual([undefined, undefined, undefined, undefined, undefined])
    await flushPromises()
    expect(executedItemIds).not.toContain('pending')
  })

  it('waits for interrupted running tasks to really finish before waitForRunning resolves', async () => {
    const manager = new KnowledgeQueueManager()
    const started = createDeferred()
    const finish = createDeferred()
    let waitResolved = false
    let signalAbortedAfterFinish = false

    const taskPromise = manager.enqueue(
      createIndexTask('running', async (context) => {
        started.resolve()
        await finish.promise
        signalAbortedAfterFinish = context.signal.aborted
      })
    )
    const taskError = captureError(taskPromise)

    await started.promise
    manager.interruptItems(['running'], 'deleted')

    const waitPromise = manager.waitForRunning(['running']).then(() => {
      waitResolved = true
    })
    await flushPromises()

    expect(waitResolved).toBe(false)

    finish.resolve()
    await waitPromise

    expect(signalAbortedAfterFinish).toBe(true)
    await expect(taskError).resolves.toMatchObject({ message: 'deleted' })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('treats signal throwIfAborted as a normal running task interruption', async () => {
    const manager = new KnowledgeQueueManager()
    const started = createDeferred()
    const finish = createDeferred()

    const taskPromise = manager.enqueue(
      createIndexTask('running', async (context) => {
        started.resolve()
        await finish.promise
        context.signal.throwIfAborted()
      })
    )
    const taskError = captureError(taskPromise)

    await started.promise
    manager.interruptItems(['running'], 'deleted')
    finish.resolve()

    await expect(taskError).resolves.toMatchObject({ message: 'deleted' })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('resets pending work and waits for running work to settle', async () => {
    const manager = new KnowledgeQueueManager()
    const blockers = Array.from({ length: 5 }, () => createDeferred())
    const executedItemIds: string[] = []

    const runningPromises = blockers.map((deferred, index) =>
      manager.enqueue(
        createIndexTask(`running-${index}`, async (context) => {
          executedItemIds.push(context.itemId)
          await deferred.promise
        })
      )
    )
    const runningErrors = runningPromises.map(captureError)

    await vi.waitFor(() => {
      expect(manager.getSnapshot().running).toHaveLength(5)
    })

    const pendingPromise = manager.enqueue(
      createIndexTask('pending', async (context) => {
        executedItemIds.push(context.itemId)
      })
    )
    const pendingError = captureError(pendingPromise)
    let resetResolved = false

    const resetPromise = manager.reset('reset').then((entries) => {
      resetResolved = true
      return entries
    })

    await expect(pendingError).resolves.toMatchObject({ message: 'reset' })
    await flushPromises()
    expect(resetResolved).toBe(false)

    for (const blocker of blockers) {
      blocker.resolve()
    }

    await expect(resetPromise).resolves.toEqual([
      ...Array.from({ length: 5 }, (_, index) => createTaskDescriptor(`running-${index}`)),
      createTaskDescriptor('pending')
    ])
    await expect(Promise.all(runningErrors)).resolves.toEqual(
      Array.from({ length: 5 }, () => expect.objectContaining({ message: 'reset' }))
    )
    expect(manager.getSnapshot()).toEqual({ pending: [], running: [] })
    expect(executedItemIds).toEqual(['running-0', 'running-1', 'running-2', 'running-3', 'running-4'])
  })

  it('rejects new work while reset is waiting for running work', async () => {
    const manager = new KnowledgeQueueManager()
    const started = createDeferred()
    const finish = createDeferred()
    const executeAfterReset = vi.fn(async () => undefined)

    const runningPromise = manager.enqueue(
      createIndexTask('running', async () => {
        started.resolve()
        await finish.promise
      })
    )
    const runningError = captureError(runningPromise)

    await started.promise

    const resetPromise = manager.reset('reset')
    const rejectedDuringReset = captureError(manager.enqueue(createIndexTask('during-reset', executeAfterReset)))

    await expect(rejectedDuringReset).resolves.toMatchObject({ message: 'reset' })
    expect(executeAfterReset).not.toHaveBeenCalled()

    finish.resolve()

    await expect(resetPromise).resolves.toEqual([createTaskDescriptor('running')])
    await expect(runningError).resolves.toMatchObject({ message: 'reset' })

    await expect(manager.enqueue(createIndexTask('after-reset', executeAfterReset))).resolves.toBeUndefined()
    expect(executeAfterReset).toHaveBeenCalledOnce()
  })

  it('rejects a second reset with the current reset reason while reset is running', async () => {
    const manager = new KnowledgeQueueManager()
    const started = createDeferred()
    const finish = createDeferred()

    const runningPromise = manager.enqueue(
      createIndexTask('running', async () => {
        started.resolve()
        await finish.promise
      })
    )
    const runningError = captureError(runningPromise)

    await started.promise

    const resetPromise = manager.reset('first-reset')
    const secondResetError = captureError(manager.reset('second-reset'))

    await expect(secondResetError).resolves.toMatchObject({ message: 'first-reset' })

    finish.resolve()

    await expect(resetPromise).resolves.toEqual([createTaskDescriptor('running')])
    await expect(runningError).resolves.toMatchObject({ message: 'first-reset' })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('serializes writes for the same base', async () => {
    const manager = new KnowledgeQueueManager()
    const releaseFirstWrite = createDeferred()
    const firstInWriteLock = createDeferred()
    const secondStarted = createDeferred()
    const events: string[] = []

    const firstPromise = manager.enqueue(
      createIndexTask('first', async (context) => {
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:first')
          firstInWriteLock.resolve()
          await releaseFirstWrite.promise
          events.push('unlock:first')
        })
      })
    )
    const secondPromise = manager.enqueue(
      createIndexTask('second', async (context) => {
        secondStarted.resolve()
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:second')
        })
      })
    )

    await firstInWriteLock.promise
    await secondStarted.promise
    await flushPromises()

    expect(events).toEqual(['lock:first'])

    releaseFirstWrite.resolve()
    await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([undefined, undefined])
    expect(events).toEqual(['lock:first', 'unlock:first', 'lock:second'])
  })

  it('serializes external writes with queued writes for the same base', async () => {
    const manager = new KnowledgeQueueManager()
    const releaseQueuedWrite = createDeferred()
    const queuedInWriteLock = createDeferred()
    const events: string[] = []

    const queuedPromise = manager.enqueue(
      createIndexTask('queued', async (context) => {
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:queued')
          queuedInWriteLock.resolve()
          await releaseQueuedWrite.promise
          events.push('unlock:queued')
        })
      })
    )

    await queuedInWriteLock.promise
    const externalPromise = manager.runWithBaseWriteLockForBase(BASE_ID, async () => {
      events.push('lock:external')
    })
    await flushPromises()

    expect(events).toEqual(['lock:queued'])

    releaseQueuedWrite.resolve()
    await expect(Promise.all([queuedPromise, externalPromise])).resolves.toEqual([undefined, undefined])
    expect(events).toEqual(['lock:queued', 'unlock:queued', 'lock:external'])
  })

  it('does not block different-base external writes', async () => {
    const manager = new KnowledgeQueueManager()
    const releaseFirstBaseWrite = createDeferred()
    const firstBaseInWriteLock = createDeferred()
    const events: string[] = []

    const queuedPromise = manager.enqueue(
      createIndexTask('queued', async (context) => {
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:base-1')
          firstBaseInWriteLock.resolve()
          await releaseFirstBaseWrite.promise
          events.push('unlock:base-1')
        })
      })
    )

    await firstBaseInWriteLock.promise
    await manager.runWithBaseWriteLockForBase('base-2', async () => {
      events.push('lock:base-2')
    })

    expect(events).toEqual(['lock:base-1', 'lock:base-2'])

    releaseFirstBaseWrite.resolve()
    await expect(queuedPromise).resolves.toBeUndefined()
    expect(events).toEqual(['lock:base-1', 'lock:base-2', 'unlock:base-1'])
  })

  it('does not enter the base write lock body after being interrupted while waiting', async () => {
    const manager = new KnowledgeQueueManager()
    const releaseFirstWrite = createDeferred()
    const firstInWriteLock = createDeferred()
    const secondStarted = createDeferred()
    const events: string[] = []

    const firstPromise = manager.enqueue(
      createIndexTask('first', async (context) => {
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:first')
          firstInWriteLock.resolve()
          await releaseFirstWrite.promise
          events.push('unlock:first')
        })
      })
    )
    const secondPromise = manager.enqueue(
      createIndexTask('second', async (context) => {
        secondStarted.resolve()
        await context.runWithBaseWriteLock(async () => {
          events.push('lock:second')
        })
      })
    )
    const secondError = captureError(secondPromise)

    await firstInWriteLock.promise
    await secondStarted.promise

    manager.interruptItems(['second'], 'deleted')
    releaseFirstWrite.resolve()

    await expect(firstPromise).resolves.toBeUndefined()
    await expect(secondError).resolves.toMatchObject({ message: 'deleted' })
    expect(events).toEqual(['lock:first', 'unlock:first'])
  })

  it('rejects failed tasks, logs unexpected errors, and continues later work', async () => {
    const manager = new KnowledgeQueueManager()
    const executeNext = vi.fn(async () => undefined)
    const failure = new Error('execute failed')

    const failedPromise = manager.enqueue(
      createIndexTask('failed', async () => {
        throw failure
      })
    )
    const failedError = captureError(failedPromise)
    const nextPromise = manager.enqueue(createIndexTask('next', executeNext))

    await expect(failedError).resolves.toBe(failure)
    await expect(nextPromise).resolves.toBeUndefined()
    expect(executeNext).toHaveBeenCalledOnce()
    expect(manager.getSnapshot()).toEqual({ pending: [], running: [] })
    expect(loggerErrorMock).toHaveBeenCalledWith('Knowledge queue task failed unexpectedly', failure, {
      baseId: BASE_ID,
      itemId: 'failed',
      kind: 'index-leaf'
    })
  })

  it('logs non-interruption errors even after a task has been aborted', async () => {
    const manager = new KnowledgeQueueManager()
    const started = createDeferred()
    const finish = createDeferred()
    const failure = new Error('failed after abort')

    const taskPromise = manager.enqueue(
      createIndexTask('running', async (context) => {
        started.resolve()
        await finish.promise

        if (context.signal.aborted) {
          throw failure
        }
      })
    )
    const taskError = captureError(taskPromise)

    await started.promise
    manager.interruptItems(['running'], 'deleted')
    finish.resolve()

    await expect(taskError).resolves.toBe(failure)
    expect(loggerErrorMock).toHaveBeenCalledWith('Knowledge queue task failed unexpectedly', failure, {
      baseId: BASE_ID,
      itemId: 'running',
      kind: 'index-leaf'
    })
  })
})
