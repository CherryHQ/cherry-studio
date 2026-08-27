import { describe, expect, it } from 'vitest'

import {
  OwnedOperationAttemptDisposition,
  OwnedOperationPhase,
  OwnedOperationRegistry
} from '../OwnedOperationRegistry'

describe('OwnedOperationRegistry', () => {
  it('registers an operation before its first attempt starts', () => {
    const registry = new OwnedOperationRegistry<string>()
    const operation = registry.open('persist:1')

    expect(registry.openOperations()).toEqual([operation])
    expect(registry.phase(operation)).toBe(OwnedOperationPhase.Retained)

    const attempt = registry.beginAttempt(operation)
    expect(registry.activeAttempts()).toEqual([attempt])
    expect(registry.phase(operation)).toBe(OwnedOperationPhase.Executing)
  })

  it('retains the stable obligation after a failed attempt', async () => {
    const registry = new OwnedOperationRegistry<string>()
    const operation = registry.open('persist:1')
    const attempt = registry.beginAttempt(operation)
    let operationSettled = false
    void operation.completed.then(() => {
      operationSettled = true
    })

    expect(registry.settleAttempt(attempt, OwnedOperationAttemptDisposition.Retain)).toBe(true)
    await attempt.completed
    await Promise.resolve()

    expect(operationSettled).toBe(false)
    expect(registry.openOperations()).toEqual([operation])
    expect(registry.activeAttempts()).toEqual([])
    expect(registry.phase(operation)).toBe(OwnedOperationPhase.Retained)
  })

  it('allows only one active attempt per operation', () => {
    const registry = new OwnedOperationRegistry<string>()
    const operation = registry.open('persist:1')
    registry.beginAttempt(operation)

    expect(() => registry.beginAttempt(operation)).toThrow('already has an active attempt')
    expect(() => registry.open('persist:1')).toThrow('already open')
  })

  it('rejects stale attempts and handles after an ID is reused', async () => {
    const registry = new OwnedOperationRegistry<string>()
    const oldOperation = registry.open('persist:1')
    const oldAttempt = registry.beginAttempt(oldOperation)
    expect(registry.settleAttempt(oldAttempt, OwnedOperationAttemptDisposition.Complete)).toBe(true)
    await expect(oldOperation.completed).resolves.toBe(OwnedOperationAttemptDisposition.Complete)

    const newOperation = registry.open('persist:1')
    const newAttempt = registry.beginAttempt(newOperation)

    expect(registry.settleAttempt(oldAttempt, OwnedOperationAttemptDisposition.Abandon)).toBe(false)
    expect(registry.settle(oldOperation, OwnedOperationAttemptDisposition.Abandon)).toBe(false)
    expect(registry.activeAttempts()).toEqual([newAttempt])
  })

  it.each([OwnedOperationAttemptDisposition.Complete, OwnedOperationAttemptDisposition.Abandon] as const)(
    'settles an operation exactly once as %s',
    async (disposition) => {
      const registry = new OwnedOperationRegistry<string>()
      const operation = registry.open('persist:1')

      expect(registry.settle(operation, disposition)).toBe(true)
      expect(registry.settle(operation, disposition)).toBe(false)
      await expect(operation.completed).resolves.toBe(disposition)
      expect(registry.openOperations()).toEqual([])
    }
  )
})
