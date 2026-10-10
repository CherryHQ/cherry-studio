import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWindowMock } = vi.hoisted(() => ({
  getWindowMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WindowManager: {
      getWindow: getWindowMock
    }
  })
})

import {
  bindNotesRelocationSessionOwnerWindow,
  handleNotesRelocationOwnerWindowGone,
  isNotesRelocationOwnerWindowAlive,
  resetNotesRelocationOwnerLifecycleForTests
} from '../notesRelocationOwnerLifecycle'
import { acquireNotesRelocationSession, resetNotesRelocationSessionForTests } from '../notesRelocationSession'
import {
  registerRendererNotesEditsFlushWindow,
  unregisterRendererNotesEditsFlushWindow
} from '../requestRendererNotesEditsFlush'

describe('notesRelocationOwnerLifecycle', () => {
  beforeEach(() => {
    resetNotesRelocationSessionForTests()
    resetNotesRelocationOwnerLifecycleForTests()
    getWindowMock.mockReset()
    unregisterRendererNotesEditsFlushWindow('owner-window')
  })

  it('reports when the owner window is no longer alive', () => {
    getWindowMock.mockReturnValue(undefined)
    expect(isNotesRelocationOwnerWindowAlive('owner-window')).toBe(false)

    getWindowMock.mockReturnValue({ isDestroyed: () => true })
    expect(isNotesRelocationOwnerWindowAlive('owner-window')).toBe(false)

    getWindowMock.mockReturnValue({ isDestroyed: () => false })
    expect(isNotesRelocationOwnerWindowAlive('owner-window')).toBe(true)
  })

  it('releases the session when the bound owner window closes', () => {
    const ownerWindow = new EventEmitter() as EventEmitter & { isDestroyed: () => boolean }
    ownerWindow.isDestroyed = () => false
    getWindowMock.mockReturnValue(ownerWindow)

    acquireNotesRelocationSession('owner-window')
    registerRendererNotesEditsFlushWindow('owner-window')

    let released = false
    bindNotesRelocationSessionOwnerWindow('owner-window', () => {
      handleNotesRelocationOwnerWindowGone('owner-window', () => {
        released = true
      })
    })

    ownerWindow.emit('closed')

    expect(released).toBe(true)
  })
})
