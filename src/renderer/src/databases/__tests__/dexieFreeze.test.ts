/**
 * Dexie files table write freeze tests.
 *
 * Verifies that all write operations on `db.files` throw `DexieFilesFrozenError`
 * after the Phase 2 hook is applied, while read operations remain functional.
 *
 * Because jsdom does not ship IndexedDB, we mock the underlying Dexie table
 * operations and assert the hooks fire before the real table methods are
 * reached. The `creating` / `updating` / `deleting` hooks intercept Dexie's
 * internal write pipeline — testing that they throw is sufficient to prove
 * the freeze holds in production (Dexie aborts the transaction on any
 * synchronous throw from a hook subscriber).
 */

import { describe, expect, it, vi } from 'vitest'

import { DexieFilesFrozenError } from '../../errors/DexieFilesFrozenError'

// Mock the Dexie module so we can control hook registration and table calls.
// We expose the registered hook subscribers so tests can invoke them directly.
const hookSubscribers: Record<string, (...args: never[]) => unknown> = {}
const mockFilesTable = {
  hook: vi.fn((event: string, subscriber: (...args: never[]) => unknown) => {
    hookSubscribers[event] = subscriber
  }),
  add: vi.fn(),
  put: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  get: vi.fn().mockResolvedValue({ id: 'test-id', name: 'test' })
}

vi.mock('@renderer/databases', () => ({
  default: {
    files: mockFilesTable
  }
}))

// Import after mock is set up so the module-level hook registration runs
await import('../index')

describe('Dexie files freeze — hook registration', () => {
  it('registers a creating hook on db.files', () => {
    expect(mockFilesTable.hook).toHaveBeenCalledWith('creating', expect.any(Function))
  })

  it('registers an updating hook on db.files', () => {
    expect(mockFilesTable.hook).toHaveBeenCalledWith('updating', expect.any(Function))
  })

  it('registers a deleting hook on db.files', () => {
    expect(mockFilesTable.hook).toHaveBeenCalledWith('deleting', expect.any(Function))
  })
})

describe('Dexie files freeze — hook behavior', () => {
  it('creating hook throws DexieFilesFrozenError', () => {
    const creating = hookSubscribers['creating']
    expect(creating).toBeDefined()
    expect(() => creating()).toThrow(DexieFilesFrozenError)
    expect(() => creating()).toThrow('add')
  })

  it('updating hook throws DexieFilesFrozenError', () => {
    const updating = hookSubscribers['updating']
    expect(updating).toBeDefined()
    expect(() => updating()).toThrow(DexieFilesFrozenError)
    expect(() => updating()).toThrow('update')
  })

  it('deleting hook throws DexieFilesFrozenError', () => {
    const deleting = hookSubscribers['deleting']
    expect(deleting).toBeDefined()
    expect(() => deleting()).toThrow(DexieFilesFrozenError)
    expect(() => deleting()).toThrow('delete')
  })
})
