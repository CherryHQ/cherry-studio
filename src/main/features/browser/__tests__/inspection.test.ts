import { afterEach, describe, expect, it, vi } from 'vitest'

import { settleAction } from '../actions/settle'
import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose())
  vi.useRealTimers()
})
function setup(ownership: 'managed' | 'borrowed' = 'managed') {
  const { guest, mock } = createGuest()
  const session = new GuestSession(guest, ownership)
  sessions.push(session)
  const emit = (method: string, params: object, sessionId?: string) =>
    mock.debugger.emit('message', {}, method, params, sessionId)
  return {
    session,
    mock,
    emit,
    log: (text: string, type = 'log') =>
      emit('Runtime.consoleAPICalled', {
        type,
        args: [{ type: 'string', value: text }],
        timestamp: 1,
        executionContextId: 1
      }),
    request: (requestId: string, url = 'https://example.com/data', extra = {}) =>
      emit('Network.requestWillBeSent', {
        requestId,
        type: 'Fetch',
        request: { method: 'GET', url, headers: { Authorization: 'SECRET' }, postData: 'SECRET' },
        ...extra
      })
  }
}

describe('per-guest browser inspection', () => {
  it('records console warnings and exceptions, and clears only the selected level', () => {
    const { session, log, emit } = setup()
    log('info')
    log('warning', 'warning')
    log('error', 'error')
    emit('Runtime.exceptionThrown', {
      timestamp: 2,
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'Error: page failed' },
        url: 'https://user:SECRET@example.com/script.js'
      }
    })
    const errors = session.consoleMessages('error', true)
    expect(errors.messages.map((entry) => entry.text)).toEqual(['error', 'Error: page failed'])
    expect(JSON.stringify(errors)).not.toContain('SECRET')
    expect(session.consoleMessages().messages.map((entry) => entry.text)).toEqual(['info', 'warning'])
    expect(session.consoleMessages('warning').messages[0].level).toBe('warning')
    session.consoleMessages('all', true)
    expect(session.consoleMessages().messages).toEqual([])
  })

  it('keeps at most 200 console entries and caps individual text and serialized output', () => {
    const { session, log } = setup()
    for (let i = 0; i < 250; i++) log(String(i))
    const short = session.consoleMessages('all', true)
    expect(short.messages).toHaveLength(200)
    expect(short.messages[0].text).toBe('50')
    expect(short.messages.at(-1)?.text).toBe('249')
    for (let i = 0; i < 200; i++) log('"'.repeat(100_000))
    const large = session.consoleMessages()
    expect(large.truncated).toBe(true)
    expect(large.messages.every((entry) => entry.text.length <= 2000)).toBe(true)
    expect(JSON.stringify(large.messages).length).toBeLessThanOrEqual(40_000)
  })

  it('formats remote objects without invoking page getters or retaining handles', () => {
    const { session, emit } = setup()
    emit('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1,
      executionContextId: 1,
      args: [
        { type: 'object', description: 'Object', objectId: 'REMOTE_HANDLE' },
        { type: 'bigint', unserializableValue: '1n' }
      ]
    })
    expect(session.consoleMessages().messages[0].text).toBe('Object 1n')
    expect(JSON.stringify(session.consoleMessages())).not.toContain('REMOTE_HANDLE')
  })

  it('keeps redirect hops and correlates completion/failure without exposing headers or bodies', () => {
    const { session, request, emit } = setup()
    request('redirect', 'https://user:SECRET@example.com/start')
    request('redirect', 'https://example.com/end', { redirectResponse: { status: 302 } })
    emit('Network.responseReceived', { requestId: 'redirect', type: 'Fetch', response: { status: 200 } })
    emit('Network.loadingFinished', { requestId: 'redirect' })
    request('failed')
    emit('Network.loadingFailed', { requestId: 'failed', errorText: 'net::ERR_FAILED' })
    const result = session.networkRequests()
    expect(result.requests.map(({ status, state }) => ({ status, state }))).toEqual([
      { status: 302, state: 'redirected' },
      { status: 200, state: 'completed' },
      { status: undefined, state: 'failed' }
    ])
    expect(result.requests[2].error).toBe('net::ERR_FAILED')
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(JSON.stringify(result)).not.toContain('headers')
    expect(JSON.stringify(result)).not.toContain('postData')
  })

  it('bounds request storage and does not resurrect cleared or evicted requests on late events', () => {
    const { session, request, emit } = setup()
    for (let i = 0; i < 250; i++) request(String(i))
    expect(session.networkRequests().requests).toHaveLength(200)
    expect(session.networkRequests().requests[0].requestId).toBe('50')
    emit('Network.responseReceived', { requestId: '0', type: 'Fetch', response: { status: 200 } })
    expect(session.networkRequests().requests.some((entry) => entry.requestId === '0')).toBe(false)
    const observed = session.networkRequests(true)
    emit('Network.loadingFinished', { requestId: '249' })
    expect(session.networkRequests().requests).toEqual([])
    expect(observed.requests.at(-1)?.state).toBe('pending')
    for (let i = 0; i < 200; i++) request(String(i), 'https://example.com/' + 'a'.repeat(10_000))
    const bounded = session.networkRequests()
    expect(bounded.truncated).toBe(true)
    expect(bounded.requests.every((entry) => entry.url.length <= 2000)).toBe(true)
    expect(JSON.stringify(bounded.requests).length).toBeLessThanOrEqual(40_000)
  })

  it('isolates guests, ignores child debugger sessions, and releases history on detach/disposal', async () => {
    const first = setup()
    const second = setup()
    const borrowed = setup('borrowed')
    await first.session.send('Runtime.enable')
    first.log('first')
    second.log('second')
    borrowed.log('borrowed')
    first.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'child' }] }, 'child-session')
    first.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'new-document' } })
    expect(first.session.consoleMessages().messages.map((entry) => entry.text)).toEqual(['first'])
    expect(second.session.consoleMessages().messages.map((entry) => entry.text)).toEqual(['second'])
    expect(borrowed.session.consoleMessages().messages).toEqual([])
    first.mock.debugger.detach()
    expect(first.session.consoleMessages().messages).toEqual([])
    first.session.dispose()
    expect(() => first.session.consoleMessages()).toThrow('debugger_unavailable')
    expect(() => first.session.networkRequests()).toThrow('debugger_unavailable')
  })

  it('clearing inspection does not let settle finish while a fetch is still running', async () => {
    vi.useFakeTimers()
    const { session, request, emit } = setup()
    let settled = false
    const action = settleAction(session, async () => {
      request('fetch')
    }).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(500)
    session.networkRequests(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(settled).toBe(false)
    emit('Network.loadingFinished', { requestId: 'fetch' })
    await vi.advanceTimersByTimeAsync(299)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(51)
    await action
    expect(session.networkRequests().requests).toEqual([])
  })
})
