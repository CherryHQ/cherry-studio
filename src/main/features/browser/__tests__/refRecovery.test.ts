import { afterEach, describe, expect, it } from 'vitest'

import { withElement } from '../actions/resolveTarget'
import { GuestSession } from '../session/GuestSession'
import type { CdpAccessibilityNode } from '../snapshot/accessibilityTypes'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()))

async function setup(names = ['Save']) {
  const { guest, mock } = createGuest()
  const session = new GuestSession(guest, 'managed')
  sessions.push(session)
  let nodes: CdpAccessibilityNode[] = names.map((name, index) => ({
    nodeId: String(index + 1),
    backendDOMNodeId: index + 1,
    ignored: false,
    role: { value: 'button' },
    name: { value: name },
    frameId: 'main'
  }))
  const connected = new Set(nodes.map((node) => node.backendDOMNodeId!))
  const fallback = mock.debugger.sendCommand.getMockImplementation()!
  mock.debugger.sendCommand.mockImplementation(async (method, params: any = {}) => {
    if (method === 'DOM.getDocument') return { root: { backendNodeId: 1000 } }
    if (method === 'Accessibility.queryAXTree')
      return {
        nodes: nodes.filter(
          (node) =>
            (!params.role || node.role?.value === params.role) &&
            (!params.accessibleName || node.name?.value === params.accessibleName)
        )
      }
    if (method === 'Accessibility.getFullAXTree') return { nodes }
    if (method === 'DOMSnapshot.captureSnapshot')
      return {
        strings: ['main', 'BUTTON', 'auto', 'block', 'visible', '1'],
        documents: [
          {
            frameId: 0,
            nodes: {
              backendNodeId: nodes.map((node) => node.backendDOMNodeId),
              nodeName: nodes.map(() => 1),
              attributes: nodes.map(() => [])
            },
            layout: {
              nodeIndex: nodes.map((_, i) => i),
              bounds: nodes.map(() => [0, 0, 100, 20]),
              styles: nodes.map(() => [2, 3, 4, 5])
            }
          }
        ]
      }
    if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0, w: 800, h: 600 } } }
    if (method === 'DOM.resolveNode') return { object: { objectId: String(params.backendNodeId) } }
    if (method === 'Runtime.callFunctionOn') return { result: { value: connected.has(Number(params.objectId)) } }
    return fallback(method, params)
  })
  const initial = await session.snapshot()
  return {
    session,
    mock,
    initial,
    connected,
    replace: (next: CdpAccessibilityNode[]) => {
      nodes = next
    },
    node: (id: number, name = 'Save'): CdpAccessibilityNode => ({
      nodeId: String(id),
      backendDOMNodeId: id,
      ignored: false,
      role: { value: 'button' },
      name: { value: name },
      frameId: 'main'
    })
  }
}

describe('document-bound ref recovery and find', () => {
  it.each(['disconnected', 'missing'])(
    'recovers a unique re-rendered button when its original node is %s',
    async (failure) => {
      const { session, mock, connected, replace, node } = await setup()
      connected.delete(1)
      connected.add(2)
      replace([node(2)])
      const fallback = mock.debugger.sendCommand.getMockImplementation()!
      mock.debugger.sendCommand.mockImplementation(async (method, params: any) => {
        if (failure === 'missing' && method === 'DOM.resolveNode' && params.backendNodeId === 1)
          throw new Error('No node with given id found')
        return fallback(method, params)
      })
      const actedOn: number[] = []
      await withElement(session, 'e1', async (_object, id) => {
        actedOn.push(id)
      })
      expect(actedOn).toEqual([2])
      expect(session.resolveRef('e1')).toBe(2)
      expect((await session.snapshot()).snapshot.nodes[0].ref).toBe('e1')
    }
  )

  it.each(['original', 'replacement'])('rejects ambiguous %s matches without invoking an action', async (phase) => {
    const { session, connected, replace, node } = await setup(phase === 'original' ? ['Save', 'Save'] : ['Save'])
    connected.clear()
    connected.add(3)
    connected.add(4)
    replace(phase === 'replacement' ? [node(3), node(4)] : [node(3)])
    let invoked = false
    await expect(
      withElement(session, 'e1', async () => {
        invoked = true
      })
    ).rejects.toMatchObject({ code: 'stale_ref' })
    expect(invoked).toBe(false)
  })

  it('matches full accessible names rather than their truncated snapshot labels', async () => {
    const name = 'x'.repeat(200) + ' original'
    const { session, connected, replace, node } = await setup([name])
    connected.clear()
    connected.add(2)
    replace([node(2, 'x'.repeat(200) + ' other')])
    await expect(withElement(session, 'e1', async () => 'wrong target')).rejects.toMatchObject({ code: 'stale_ref' })
  })

  it.each(['before', 'during'])('never recovers across main-document navigation %s the query', async (when) => {
    const { session, mock, connected, replace, node } = await setup()
    connected.clear()
    connected.add(2)
    replace([node(2)])
    const navigate = () =>
      mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'new-document' } })
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    if (when === 'before') navigate()
    else
      mock.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (method === 'Accessibility.queryAXTree') navigate()
        return fallback(method, params)
      })
    let invoked = false
    await expect(
      withElement(session, 'e1', async () => {
        invoked = true
      })
    ).rejects.toMatchObject({ code: 'stale_ref' })
    expect(invoked).toBe(false)
  })

  it('propagates protocol errors without treating them as missing nodes', async () => {
    const { session, mock } = await setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'DOM.resolveNode') throw new Error('Protocol permission failure')
      return fallback(method, params)
    })
    await expect(withElement(session, 'e1', async () => 'unexpected')).rejects.toThrow('Protocol permission failure')
    expect(session.resolveRef('e1')).toBe(1)
  })

  it('does not retry a callback that has already caused a side effect', async () => {
    const { session } = await setup()
    let effects = 0
    await expect(
      withElement(session, 'e1', async () => {
        effects++
        throw new Error('No node with given id found')
      })
    ).rejects.toThrow('No node with given id found')
    expect(effects).toBe(1)
  })

  it('honors abort and deadline during recovery without publishing a replacement', async () => {
    const { session, mock, connected, replace, node } = await setup()
    connected.clear()
    connected.add(2)
    replace([node(2)])
    const controller = new AbortController()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'Accessibility.queryAXTree') controller.abort(new Error('Cancelled'))
      return fallback(method, params)
    })
    await expect(withElement(session, 'e1', async () => 'unexpected', { signal: controller.signal })).rejects.toThrow(
      'Cancelled'
    )
    expect(session.resolveRef('e1')).toBe(1)
    await expect(
      withElement(session, 'e1', async () => 'unexpected', { deadline: Date.now() - 1 })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('find returns usable refs without changing the snapshot diff baseline', async () => {
    const { session } = await setup(['Save', 'Cancel'])
    const found = await session.find({ role: 'button', name: 'Cancel' })
    expect(found).toEqual({ matches: [{ ref: 'e2', role: 'button', name: 'Cancel' }], truncated: false })
    expect(await withElement(session, found.matches[0].ref, async (_object, id) => id)).toBe(2)
    expect((await session.snapshot()).text).toBe('(no change)')
    expect(await session.find({ name: 'absent' })).toEqual({ matches: [], truncated: false })
    await expect(session.find({})).rejects.toMatchObject({ code: 'not_allowed' })
  })

  it('caps find results, excludes ignored and child-frame nodes, and invalidates refs on detach', async () => {
    const { session, mock, replace, node } = await setup()
    replace([
      ...Array.from({ length: 101 }, (_, i) => node(i + 10, `Button ${i}`)),
      { ...node(500), ignored: true },
      { ...node(501), frameId: 'child' }
    ])
    const found = await session.find({ role: 'button' })
    expect(found.matches).toHaveLength(100)
    expect(found.truncated).toBe(true)
    expect(found.matches.every((match) => match.name.startsWith('Button '))).toBe(true)
    mock.debugger.detach()
    expect(() => session.resolveRef(found.matches[0].ref)).toThrow('stale_ref')
  })
})
