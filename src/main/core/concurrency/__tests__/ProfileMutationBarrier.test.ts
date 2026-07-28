import { describe, expect, it } from 'vitest'

import { ProfileMutationBarrier } from '../ProfileMutationBarrier'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('ProfileMutationBarrier', () => {
  it('keeps ordinary mutations concurrent', async () => {
    const barrier = new ProfileMutationBarrier()
    const release = deferred()
    let entered = 0

    const first = barrier.runMutation(async () => {
      entered += 1
      await release.promise
    })
    const second = barrier.runMutation(async () => {
      entered += 1
      await release.promise
    })
    await tick()

    expect(entered).toBe(2)
    release.resolve()
    await Promise.all([first, second])
  })

  it('waits for in-flight mutations and blocks new mutations until the snapshot leaves', async () => {
    const barrier = new ProfileMutationBarrier()
    const releaseMutation = deferred()
    const releaseSnapshot = deferred()
    const order: string[] = []

    const firstMutation = barrier.runMutation(async () => {
      order.push('mutation:start')
      await releaseMutation.promise
      order.push('mutation:end')
    })
    const snapshot = barrier.runSnapshot(async () => {
      order.push('snapshot:start')
      await releaseSnapshot.promise
      order.push('snapshot:end')
    })
    await tick()
    const lateMutation = barrier.runMutation(() => {
      order.push('late-mutation')
    })
    await tick()
    expect(order).toEqual(['mutation:start'])

    releaseMutation.resolve()
    await firstMutation
    await tick()
    expect(order).toEqual(['mutation:start', 'mutation:end', 'snapshot:start'])

    releaseSnapshot.resolve()
    await Promise.all([snapshot, lateMutation])
    expect(order).toEqual(['mutation:start', 'mutation:end', 'snapshot:start', 'snapshot:end', 'late-mutation'])
  })

  it('treats nested owner calls as one lease even after a snapshot becomes pending', async () => {
    const barrier = new ProfileMutationBarrier()
    const enterNested = deferred()
    const order: string[] = []

    const mutation = barrier.runMutation(async () => {
      order.push('outer:start')
      await enterNested.promise
      await barrier.runMutation(() => {
        order.push('nested')
      })
      order.push('outer:end')
    })
    await tick()
    const snapshot = barrier.runSnapshot(() => {
      order.push('snapshot')
    })
    await tick()

    enterNested.resolve()
    await Promise.all([mutation, snapshot])
    expect(order).toEqual(['outer:start', 'nested', 'outer:end', 'snapshot'])
  })

  it('rejects snapshot acquisition from inside a mutation instead of deadlocking', async () => {
    const barrier = new ProfileMutationBarrier()
    await expect(barrier.runMutation(() => barrier.runSnapshot(() => undefined))).rejects.toThrow(
      /cannot start a snapshot inside/
    )
  })

  it('releases both queues when a task throws', async () => {
    const barrier = new ProfileMutationBarrier()
    await expect(
      barrier.runSnapshot(() => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(barrier.runMutation(() => 42)).resolves.toBe(42)

    await expect(
      barrier.runMutation(() => {
        throw new Error('mutation boom')
      })
    ).rejects.toThrow('mutation boom')
    await expect(barrier.runSnapshot(() => 7)).resolves.toBe(7)
  })
})
