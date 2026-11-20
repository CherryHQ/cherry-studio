import type { EventEmitter } from 'node:events'

import { ipcRenderer as electronIpcRenderer } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'

import { ipcApi } from '../ipc'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcRenderer: new EventEmitter() }
})

const ipcRenderer = electronIpcRenderer as unknown as EventEmitter
const emit = (name: string, payload: unknown) => ipcRenderer.emit(IpcChannel.IpcApi_Event, {}, name, payload)

describe('ipcApi.on', () => {
  // One Electron listener per subscriber tripped MaxListenersExceededWarning past ten subscribers.
  it('keeps one channel listener however many events are subscribed', () => {
    const unsubscribes = Array.from({ length: 20 }, (_, i) => ipcApi.on(`event.${i}`, () => {}))

    expect(ipcRenderer.listenerCount(IpcChannel.IpcApi_Event)).toBe(1)
    unsubscribes.forEach((unsubscribe) => unsubscribe())
  })

  it('delivers each event only to its own subscribers until they unsubscribe', () => {
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    const unsubscribeFirst = ipcApi.on('topic.updated', first)
    const unsubscribeSecond = ipcApi.on('topic.updated', second)
    const unsubscribeOther = ipcApi.on('topic.deleted', other)

    emit('topic.updated', { id: 'a' })
    unsubscribeFirst()
    emit('topic.updated', { id: 'b' })

    expect(first.mock.calls).toEqual([[{ id: 'a' }]])
    expect(second.mock.calls).toEqual([[{ id: 'a' }], [{ id: 'b' }]])
    expect(other).not.toHaveBeenCalled()
    unsubscribeSecond()
    unsubscribeOther()
  })

  it('still delivers to the others when a subscriber unsubscribes while handling the event', () => {
    const later = vi.fn()
    const unsubscribeSelf = ipcApi.on('topic.updated', () => unsubscribeSelf())
    const unsubscribeLater = ipcApi.on('topic.updated', later)

    emit('topic.updated', 1)

    expect(later).toHaveBeenCalledExactlyOnceWith(1)
    unsubscribeLater()
  })
})
