import { beforeEach, expect, it, vi } from 'vitest'

const { appGet } = vi.hoisted(() => ({ appGet: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGet } }))
vi.mock('@main/services/AssistantAvatarService', () => ({ assistantAvatarService: { apply: vi.fn() } }))

import { assistantHandlers } from '../assistant'

let ids: string[]
const preferences = {
  get: vi.fn(() => ids),
  set: vi.fn(async (_key: string, next: string[]) => {
    await Promise.resolve()
    ids = next
  })
}
beforeEach(() => {
  ids = ['a']
  vi.clearAllMocks()
  appGet.mockReturnValue(preferences)
})

it('serializes stale-window toggle intents against the latest Main preference', async () => {
  const toggle = assistantHandlers['assistant.toggle_default_mcp']
  await Promise.all([
    toggle({ serverId: 'b', enabled: true }, { senderId: 'window-1' }),
    toggle({ serverId: 'c', enabled: true }, { senderId: 'window-2' })
  ])
  expect(ids).toEqual(['a', 'b', 'c'])
  await Promise.all([
    toggle({ serverId: 'a', enabled: false }, { senderId: 'window-1' }),
    toggle({ serverId: 'd', enabled: true }, { senderId: 'window-2' })
  ])
  expect(ids).toEqual(['b', 'c', 'd'])
})

it('recovers the write queue after a rejected persistence operation', async () => {
  preferences.set.mockRejectedValueOnce(new Error('database unavailable'))
  const toggle = assistantHandlers['assistant.toggle_default_mcp']
  await expect(toggle({ serverId: 'b', enabled: true }, { senderId: 'window-1' })).rejects.toThrow(
    'database unavailable'
  )
  await toggle({ serverId: 'c', enabled: true }, { senderId: 'window-2' })
  expect(ids).toEqual(['a', 'c'])
})
