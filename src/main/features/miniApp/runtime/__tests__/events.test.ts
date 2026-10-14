import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

const send = vi.fn()
const guestsOf = vi.fn<(appId: string) => number[]>()
vi.mock('electron', () => ({ webContents: { fromId: (id: number) => (id === 99 ? undefined : { id, send }) } }))
vi.mock('@application', () => mockMiniAppApplication({ MiniAppRuntimeService: { guestsOf } }))

const { emitToApp } = await import('../events')

describe('emitToApp', () => {
  beforeEach(() => {
    send.mockClear()
  })

  it('fans out to every live guest of the app', () => {
    guestsOf.mockReturnValue([1, 2])
    expect(emitToApp('com.example.a', 'app.localeChange', { locale: 'zh-CN' })).toBe(2)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][1]).toMatchObject({ event: 'app.localeChange', payload: { locale: 'zh-CN' } })
  })

  it('carries no ack field — every event is fire-and-forget', () => {
    // The bug this guards: re-introducing an awaited event. An ackId in the payload
    // means someone rebuilt the promise the host cannot keep.
    guestsOf.mockReturnValue([1])
    emitToApp('com.example.a', 'app.visibilityChange', { visible: false })
    expect(send.mock.calls.at(-1)![1]).not.toHaveProperty('ackId')
  })

  it('skips a webContents that is already gone', () => {
    // Guests die without notice — that is the whole execution model. A stale id in
    // the registry must not throw and must not stop the others.
    guestsOf.mockReturnValue([99, 1])
    expect(() => emitToApp('com.example.a', 'app.localeChange', { locale: 'zh-CN' })).not.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('returns zero when nothing is running', () => {
    guestsOf.mockReturnValue([])
    expect(emitToApp('com.example.a', 'app.localeChange', { locale: 'en-US' })).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})
