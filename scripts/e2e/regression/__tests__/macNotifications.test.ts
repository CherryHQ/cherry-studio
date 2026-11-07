import type * as ChildProcess from 'node:child_process'

import { vi } from 'vitest'

import * as lifecycle from '../lifecycle'
import { type AppRecord } from '../lifecycle'
import { getRunPaths } from '../paths'
import * as processes from '../process'
import { findMacNotification } from '../systemAutomation'

const { command } = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFileSync: command
}))

beforeEach(() => {
  const record = { platform: 'macos', electronPid: 42 } as AppRecord
  vi.spyOn(lifecycle, 'readAppRecord').mockReturnValue(record)
  vi.spyOn(processes, 'assertOwnedProcess').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  command.mockReset()
})

it('opens the actual notification after expanding its stack and waiting for refreshed entries', () => {
  command.mockReturnValueOnce('expanded').mockReturnValueOnce('absent').mockReturnValueOnce('found')
  expect(findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toBe(true)
})

it('never reports opening a notification when only a stack was expanded', () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  command.mockImplementation(() => {
    now += 1000
    return 'expanded'
  })
  expect(findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toBe(false)
})

it('preserves automation permission failures after a stack expands', () => {
  command.mockReturnValueOnce('expanded').mockImplementationOnce(() => {
    throw new Error('Automation permission denied')
  })
  expect(() => findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toThrow(
    'Automation permission denied'
  )
})
