import type { Protocol } from 'devtools-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Signal } from '@main/core/lifecycle'

import { handleCallWebTool, handleListWebTools } from '../mcp/tools/webMcp'
import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
const tool: Protocol.WebMCP.Tool = {
  name: 'lookup',
  description: 'Look up a product',
  frameId: 'main',
  inputSchema: {
    type: 'object',
    properties: { sku: { type: 'string' } },
    required: ['sku'],
    additionalProperties: false
  }
}
function setup() {
  const fixture = createGuest()
  const session = new GuestSession(fixture.guest, 'borrowed')
  sessions.push(session)
  const events = fixture.mock.debugger
  const emit = (method: string, params: unknown) => events.emit('message', {}, method, params)
  const calls: string[] = []
  const canceled: string[] = []
  let count = 0
  let execute: (id: string) => void = () => undefined
  const send = async (method: string, params?: object) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'doc-1' } } }
    if (method === 'Runtime.evaluate') return { result: { value: true } }
    if (method === 'WebMCP.enable') emit('WebMCP.toolsAdded', { tools: [tool] })
    if (method === 'WebMCP.invokeTool') {
      const id = `invocation-${++count}`
      calls.push(id)
      execute(id)
      return { invocationId: id }
    }
    if (method === 'WebMCP.cancelInvocation') canceled.push((params as { invocationId: string }).invocationId)
    return {}
  }
  events.sendCommand.mockImplementation(send)
  return {
    ...fixture,
    session,
    emit,
    calls,
    canceled,
    send,
    setExecute: (fn: typeof execute) => {
      execute = fn
    }
  }
}
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.dispose()
    await session.settleWebTools()
  }
  vi.useRealTimers()
})

describe('native website tools', () => {
  it('discovers main-document tools and returns structured output through the MCP handlers', async () => {
    const f = setup()
    const controller = {
      getSession: async () => ({ session: f.session, tabId: 'tab' }),
      takeNewTabId: async () => undefined
    } as unknown as Parameters<typeof handleListWebTools>[0]
    const listed = await handleListWebTools(controller, {})
    const data = JSON.parse((listed.content[0] as { text: string }).text)
    expect(data).toMatchObject({
      ok: true,
      capability: 'cdp',
      tabId: 'tab',
      tools: [{ name: 'lookup', inputSchema: tool.inputSchema }]
    })
    f.setExecute((id) =>
      f.emit('WebMCP.toolResponded', { invocationId: id, status: 'Completed', output: { price: 42 } })
    )
    const result = await handleCallWebTool(controller, { toolId: data.tools[0].toolId, args: { sku: '123' } })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      ok: true,
      output: { price: 42 },
      truncated: false
    })
    expect(f.calls).toHaveLength(1)
  })

  it('distinguishes unsupported native capability from no registered tools', async () => {
    const f = setup()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) =>
      method === 'WebMCP.enable' ? {} : f.send(method, params)
    )
    expect(await f.session.webTools.list()).toMatchObject({ capability: 'cdp', tools: [] })
    f.session.webTools.reset()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'WebMCP.enable') throw new Error("'WebMCP.enable' wasn't found")
      return f.send(method, params)
    })
    expect(await f.session.webTools.list()).toMatchObject({ capability: 'unsupported', tools: [] })
  })

  it('reports an unavailable document API and never hides a permission failure', async () => {
    const f = setup()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) =>
      method === 'Runtime.evaluate' ? { result: { value: false } } : f.send(method, params)
    )
    expect(await f.session.webTools.list()).toMatchObject({ capability: 'unsupported', tools: [] })
    f.session.webTools.reset()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'WebMCP.enable') throw new Error('Permission denied')
      return f.send(method, params)
    })
    await expect(f.session.webTools.list()).rejects.toThrow('Permission denied')
  })

  it.each(['navigate', 'detach', 'unregister', 'replace', 'contexts'])(
    'rejects a tool observed before %s without executing it',
    async (change) => {
      const f = setup()
      const { tools } = await f.session.webTools.list()
      if (change === 'navigate') f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'doc-2' } })
      if (change === 'detach') f.mock.debugger.detach()
      if (change === 'unregister') f.emit('WebMCP.toolsRemoved', { tools: [{ name: tool.name, frameId: 'main' }] })
      if (change === 'replace') f.emit('WebMCP.toolsAdded', { tools: [{ ...tool, description: 'Replacement' }] })
      if (change === 'contexts') f.emit('Runtime.executionContextsCleared', {})
      await expect(f.session.webTools.call(tools[0].toolId, { sku: '123' })).rejects.toMatchObject({
        code: 'stale_web_tool'
      })
      expect(f.calls).toEqual([])
    }
  )

  it('reports stale handles when native removal races its notification', async () => {
    const f = setup()
    const { tools } = await f.session.webTools.list()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'WebMCP.invokeTool') throw new Error('Tool not found')
      return f.send(method, params)
    })
    await expect(f.session.webTools.call(tools[0].toolId, { sku: '123' })).rejects.toMatchObject({
      code: 'stale_web_tool'
    })
    expect((await f.session.webTools.list()).tools).toEqual([])
  })

  it('rejects invalid arguments, external schemas and declarative forms before any effect', async () => {
    const f = setup()
    const { tools } = await f.session.webTools.list()
    await expect(f.session.webTools.call(tools[0].toolId, { sku: 123 })).rejects.toMatchObject({
      code: 'invalid_tool_input'
    })
    f.emit('WebMCP.toolsAdded', {
      tools: [
        { ...tool, name: 'external', inputSchema: { $ref: 'https://invalid.example/schema' } },
        { ...tool, name: 'form', backendNodeId: 5 }
      ]
    })
    const list = await f.session.webTools.list()
    for (const name of ['external', 'form']) {
      await expect(f.session.webTools.call(list.tools.find((t) => t.name === name)!.toolId, {})).rejects.toMatchObject({
        code: 'unsupported_web_tool'
      })
    }
    expect(f.calls).toEqual([])
  })

  it('ignores child frames and child debugger sessions and bounds registration metadata', async () => {
    const f = setup()
    await f.session.webTools.list()
    f.emit('WebMCP.toolsAdded', {
      tools: [
        { ...tool, name: 'iframe', frameId: 'child' },
        { ...tool, name: 'large', description: 'x'.repeat(2001) }
      ]
    })
    f.mock.debugger.emit('message', {}, 'WebMCP.toolsAdded', { tools: [{ ...tool, name: 'oopif' }] }, 'child-session')
    const result = await f.session.webTools.list()
    expect(result.tools.map((t) => t.name)).toEqual(['lookup'])
    expect(result.truncated).toBe(true)
  })

  it.each(['abort', 'timeout', 'navigate', 'dispose', 'dialog'])(
    'settles and requests cancellation on %s, ignoring late completion',
    async (reason) => {
      vi.useFakeTimers()
      const f = setup()
      const { tools } = await f.session.webTools.list()
      const started = new Signal<void>()
      f.setExecute(() => started.resolve())
      const abort = new AbortController()
      const result = f.session.webTools.call(
        tools[0].toolId,
        { sku: '123' },
        { signal: abort.signal, deadline: Date.now() + 100 }
      )
      const rejected = expect(result).rejects.toThrow()
      await started
      await vi.advanceTimersByTimeAsync(0)
      if (reason === 'abort') abort.abort(new Error('cancelled'))
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(100)
      if (reason === 'navigate') f.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'doc-2' } })
      if (reason === 'dispose') f.session.dispose()
      if (reason === 'dialog') f.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'Hi' })
      await rejected
      expect(f.canceled).toEqual(['invocation-1'])
      f.emit('WebMCP.toolResponded', { invocationId: 'invocation-1', status: 'Completed', output: 'late' })
      expect(f.calls).toHaveLength(1)
    }
  )

  it.each(['abort', 'dispose', 'abort-then-dispose'])(
    'cancels a late acknowledgement before releasing the debugger on %s',
    async (reason) => {
      const f = setup()
      const { tools } = await f.session.webTools.list()
      const ack = new Signal<{ invocationId: string }>()
      const started = new Signal<void>()
      f.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (!f.mock.debugger.isAttached()) throw new Error('Debugger detached before cancellation')
        if (method === 'WebMCP.invokeTool') {
          f.calls.push('late')
          started.resolve()
          return ack
        }
        return f.send(method, params)
      })
      const abort = new AbortController()
      const result = expect(
        f.session.webTools.call(tools[0].toolId, { sku: '123' }, { signal: abort.signal })
      ).rejects.toThrow()
      await started
      if (reason !== 'dispose') abort.abort()
      if (reason !== 'abort') f.session.dispose()
      await result
      let settled = false
      const cleanup = f.session.settleWebTools().then(() => {
        settled = true
      })
      await Promise.resolve()
      const retainedUntilAcknowledgement = f.mock.debugger.isAttached() && !settled
      ack.resolve({ invocationId: 'late' })
      await cleanup
      expect(retainedUntilAcknowledgement).toBe(true)
      expect(f.canceled).toEqual(['late'])
      expect(f.calls).toEqual(['late'])
      expect(f.mock.debugger.isAttached()).toBe(reason === 'abort')
      if (reason !== 'abort') {
        await expect(f.session.send('Runtime.enable')).rejects.toMatchObject({ code: 'debugger_unavailable' })
      }
    }
  )

  it.each(['acknowledgement', 'cancellation'])('bounds disposal when the %s never arrives', async (stage) => {
    vi.useFakeTimers()
    const f = setup()
    const { tools } = await f.session.webTools.list()
    const ack = new Signal<{ invocationId: string }>()
    const started = new Signal<void>()
    f.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'WebMCP.invokeTool') {
        started.resolve()
        return ack
      }
      if (method === 'WebMCP.cancelInvocation') {
        await f.send(method, params)
        return new Promise(() => undefined)
      }
      return f.send(method, params)
    })
    const result = expect(f.session.webTools.call(tools[0].toolId, { sku: '123' })).rejects.toThrow()
    await started
    f.session.dispose()
    await result
    let settled = false
    const cleanup = f.session.settleWebTools().then(() => {
      settled = true
    })
    if (stage === 'cancellation') ack.resolve({ invocationId: 'late' })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(stage === 'acknowledgement' ? 5000 : 1000)
    await cleanup
    expect(f.mock.debugger.isAttached()).toBe(false)
    expect(f.mock.debugger.listenerCount('message')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    if (stage === 'acknowledgement') ack.resolve({ invocationId: 'late' })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.canceled).toEqual(stage === 'acknowledgement' ? [] : ['late'])
  })

  it.each(['Canceled', 'Error'])('keeps native %s distinct from successful completion', async (status) => {
    const f = setup()
    const { tools } = await f.session.webTools.list()
    f.setExecute((id) => f.emit('WebMCP.toolResponded', { invocationId: id, status }))
    await expect(f.session.webTools.call(tools[0].toolId, { sku: '123' })).rejects.toMatchObject({
      code: status === 'Canceled' ? 'web_tool_canceled' : 'web_tool_failed'
    })
  })

  it('truncates oversized output and never exposes remote object handles', async () => {
    const f = setup()
    const { tools } = await f.session.webTools.list()
    f.setExecute((id) =>
      f.emit('WebMCP.toolResponded', {
        invocationId: id,
        status: 'Completed',
        output: 'x'.repeat(50_000),
        exception: { objectId: 'private' }
      })
    )
    const result = await f.session.webTools.call(tools[0].toolId, { sku: '123' })
    expect(result.truncated).toBe(true)
    expect(result.output).toHaveLength(40_000)
    expect(result).not.toHaveProperty('exception')
  })
})
