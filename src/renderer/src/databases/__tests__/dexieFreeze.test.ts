/**
 * Dexie files table write freeze tests.
 *
 * Verifies that all write operations on `db.files` throw `DexieFilesFrozenError`
 * after the Phase 2 hook is applied, while read operations remain functional.
 *
 * Because jsdom does not ship IndexedDB, we cannot run real `db.files.add()`
 * calls. Instead we verify:
 * 1. The hooks are registered (subscribers array is non-empty).
 * 2. The registered subscriber throws `DexieFilesFrozenError` when invoked.
 *
 * Dexie aborts the transaction on any synchronous throw from a hook subscriber,
 * so verifying the subscriber throws is sufficient to prove the freeze holds in
 * production.
 */

import { describe, expect, it } from 'vitest'

import { DexieFilesFrozenError } from '../../errors/DexieFilesFrozenError'
// Import the actual db to read the real hook subscribers.
// vi.mock('dexie') is intentionally NOT used here — we want to exercise the
// real Dexie hook API with the real db instance that has the freeze applied.
import db from '../index'

describe('Dexie files freeze — hook registration', () => {
  it('creating hook subscriber is registered on db.files', () => {
    const { subscribers } = db.files.hook.creating
    expect(subscribers.length).toBeGreaterThan(0)
  })

  it('updating hook subscriber is registered on db.files', () => {
    const { subscribers } = db.files.hook.updating
    expect(subscribers.length).toBeGreaterThan(0)
  })

  it('deleting hook subscriber is registered on db.files', () => {
    const { subscribers } = db.files.hook.deleting
    expect(subscribers.length).toBeGreaterThan(0)
  })
})

describe('Dexie files freeze — hook behavior', () => {
  it('creating subscriber throws DexieFilesFrozenError with "add"', () => {
    const subscriber = db.files.hook.creating.subscribers[0]
    expect(() => subscriber()).toThrow(DexieFilesFrozenError)
    expect(() => subscriber()).toThrow('add')
  })

  it('updating subscriber throws DexieFilesFrozenError with "update"', () => {
    const subscriber = db.files.hook.updating.subscribers[0]
    expect(() => subscriber()).toThrow(DexieFilesFrozenError)
    expect(() => subscriber()).toThrow('update')
  })

  it('deleting subscriber throws DexieFilesFrozenError with "delete"', () => {
    const subscriber = db.files.hook.deleting.subscribers[0]
    expect(() => subscriber()).toThrow(DexieFilesFrozenError)
    expect(() => subscriber()).toThrow('delete')
  })
})
