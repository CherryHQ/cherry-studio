import { createMigrate } from 'redux-persist'
import { describe, expect, it } from 'vitest'

// Isolated copy of migrate.ts version 207 — backfill notification.sound for existing users.
const migrate207 = (state: any) => {
  if (state.settings?.notification && typeof state.settings.notification.sound !== 'boolean') {
    state.settings.notification.sound = false
  }
  return state
}

const migrate = createMigrate({ '207': migrate207 as any })

describe('migration 207: notification.sound backfill', () => {
  it('adds sound=false when missing from an existing notification slice', async () => {
    const state = {
      settings: {
        notification: { assistant: true, backup: false, knowledge: false }
      },
      _persist: { version: 206, rehydrated: false }
    }
    const migrated: any = await migrate(state, 207)
    expect(migrated.settings.notification.sound).toBe(false)
    expect(migrated.settings.notification.assistant).toBe(true)
  })

  it('preserves an existing sound=true preference', async () => {
    const state = {
      settings: {
        notification: { assistant: true, backup: false, knowledge: false, sound: true }
      },
      _persist: { version: 206, rehydrated: false }
    }
    const migrated: any = await migrate(state, 207)
    expect(migrated.settings.notification.sound).toBe(true)
  })

  it('is a no-op when notification slice is missing entirely', async () => {
    const state = { settings: {}, _persist: { version: 206, rehydrated: false } }
    const migrated: any = await migrate(state, 207)
    expect(migrated.settings).toEqual({})
  })
})
