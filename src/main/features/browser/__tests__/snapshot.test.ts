import { afterEach, describe, expect, it } from 'vitest'

import { browserRefSchema, snapshotOptionsSchema } from '../browserUse'
import { GuestSession } from '../session/GuestSession'
import { buildSnapshotTree } from '../snapshot/buildSnapshotTree'
import type { RawSnapshot } from '../snapshot/captureSnapshot'
import { diffSnapshot } from '../snapshot/diffSnapshot'
import { serializeSnapshot } from '../snapshot/serializeSnapshot'
import recordedForm from './fixtures/form.json'
import { createGuest } from './guestFixture'

function fixture(): RawSnapshot {
  return {
    frameId: 'main',
    viewport: { x: 0, y: 0, w: 800, h: 600 },
    ax: [
      {
        nodeId: 'root',
        ignored: false,
        role: { value: 'RootWebArea' },
        childIds: ['label', 'input', 'button', 'password', 'far']
      },
      {
        nodeId: 'label',
        parentId: 'root',
        ignored: false,
        backendDOMNodeId: 1,
        role: { value: 'StaticText' },
        name: { value: 'Name' }
      },
      {
        nodeId: 'input',
        parentId: 'root',
        ignored: false,
        backendDOMNodeId: 2,
        role: { value: 'textbox' },
        name: { value: 'Name' },
        value: { value: 'Alice' }
      },
      {
        nodeId: 'button',
        parentId: 'root',
        ignored: false,
        backendDOMNodeId: 3,
        role: { value: 'button' },
        name: { value: 'Submit' },
        properties: [{ name: 'disabled', value: { value: true } }]
      },
      {
        nodeId: 'password',
        parentId: 'root',
        ignored: false,
        backendDOMNodeId: 4,
        role: { value: 'textbox' },
        name: { value: 'Password' },
        value: { value: 'SECRET' },
        childIds: ['secret']
      },
      {
        nodeId: 'secret',
        parentId: 'password',
        ignored: false,
        backendDOMNodeId: 5,
        role: { value: 'StaticText' },
        name: { value: 'SECRET' }
      },
      {
        nodeId: 'far',
        parentId: 'root',
        ignored: false,
        backendDOMNodeId: 6,
        role: { value: 'button' },
        name: { value: 'Below' }
      }
    ],
    dom: {
      strings: ['main', 'INPUT', 'BUTTON', '#text', 'type', 'password', 'auto', 'block', 'visible', '1'],
      documents: [
        {
          frameId: 0,
          nodes: {
            backendNodeId: [1, 2, 3, 4, 5, 6],
            parentIndex: [-1, -1, -1, -1, 3, -1],
            nodeName: [3, 1, 2, 1, 3, 2],
            attributes: [[], [], [], [4, 5], [], []]
          },
          layout: {
            nodeIndex: [0, 1, 2, 3, 4, 5],
            bounds: [
              [0, 0, 80, 20],
              [0, 30, 100, 20],
              [0, 60, 100, 20],
              [0, 90, 100, 20],
              [0, 90, 100, 20],
              [0, 5000, 100, 20]
            ],
            styles: Array.from({ length: 6 }, () => [6, 7, 8, 9, 6])
          }
        }
      ]
    }
  }
}

const sessions: GuestSession[] = []
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()))
function setup() {
  const { guest, mock } = createGuest()
  let raw = fixture()
  const fallback = mock.debugger.sendCommand.getMockImplementation()!
  mock.debugger.sendCommand.mockImplementation(async (method, params) => {
    if (method === 'Accessibility.getFullAXTree') return { nodes: raw.ax }
    if (method === 'DOMSnapshot.captureSnapshot') return raw.dom
    if (method === 'Runtime.evaluate') return { result: { value: raw.viewport } }
    return fallback(method, params)
  })
  const session = new GuestSession(guest, 'borrowed')
  sessions.push(session)
  return {
    session,
    mock,
    raw,
    replace: (value: RawSnapshot) => {
      raw = value
    }
  }
}

describe('browser snapshots', () => {
  it('handles a real Chromium form without labeling native labels as actions or exposing password values', () => {
    const tree = buildSnapshotTree(recordedForm as RawSnapshot, (id) => `e${id}`)
    expect(tree.nodes.find((node) => node.name === 'Name' && node.role === 'textbox')?.value).toBe('Alice')
    expect(tree.nodes.find((node) => node.name === 'Password' && node.role === 'textbox')?.value).toBeUndefined()
    expect(tree.nodes.find((node) => node.name === 'Shadow action' && node.role === 'button')?.ref).toBeDefined()
    expect(tree.nodes.some((node) => node.role === 'labeltext' && node.ref)).toBe(false)
    expect(tree.nodes.some((node) => node.name === 'Invisible action')).toBe(false)
    expect(JSON.stringify(tree.nodes)).not.toContain('SYNTHETIC_PASSWORD')
  })

  it('does not copy data URL payloads or URL credentials into the snapshot header', () => {
    const tree = buildSnapshotTree(fixture(), (id) => `e${id}`)
    const base = { ...tree, documentId: 'doc', title: 'Form', truncated: false }
    expect(serializeSnapshot({ ...base, url: 'data:text/html,<input value="SECRET">' }, 40_000).text).not.toContain(
      'SECRET'
    )
    expect(serializeSnapshot({ ...base, url: 'https://user:SECRET@example.com/' }, 40_000).text).not.toContain('SECRET')
  })

  it('rejects incomplete DOM attributes instead of losing password identification', () => {
    const raw = fixture()
    raw.dom!.documents[0].nodes.attributes = undefined
    expect(() => buildSnapshotTree(raw, (id) => `e${id}`)).toThrow('DOM snapshot is incomplete')
  })

  it('validates refs and enforces a bounded output request', () => {
    expect(browserRefSchema.safeParse('e12').success).toBe(true)
    expect(browserRefSchema.safeParse('12').success).toBe(false)
    expect(snapshotOptionsSchema.safeParse({ maxChars: 40_001 }).success).toBe(false)
    expect(snapshotOptionsSchema.safeParse({ maxChars: -1 }).success).toBe(false)
    expect(snapshotOptionsSchema.safeParse({ scope: 'e12', full: true }).success).toBe(true)
  })

  it('emits actionable fields, suppresses passwords and accounts for offscreen nodes', async () => {
    const { session } = setup()
    const result = await session.snapshot()
    expect(result.text).toContain('[e1] textbox "Name" value="Alice"')
    expect(result.text).toContain('[e2] button "Submit" (disabled)')
    expect(result.text).toContain('[e3] textbox "Password"')
    expect(result.text).toContain('statictext "Name"')
    expect(result.text).toContain('3 interactive / 4 total')
    expect(result.text).toContain('1 more nodes')
    expect(result.text).not.toContain('SECRET')
    expect(session.resolveRef('e2')).toBe(3)
    expect((await session.snapshot()).text).toBe('(no change)')
  })

  it('preserves refs after subframe navigation but never reuses them across documents', async () => {
    const { session, mock } = setup()
    await session.snapshot()
    mock.debugger.emit('message', {}, 'Page.frameNavigated', {
      frame: { id: 'child', parentId: 'main', loaderId: 'child-2' }
    })
    expect(session.resolveRef('e1')).toBe(2)
    mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-2' } })
    expect(() => session.resolveRef('e1')).toThrow('stale_ref')
    const next = await session.snapshot()
    expect(next.text).toContain('[e4] textbox')
    expect(next.snapshot.documentId).toBe('document-2')
  })

  it('discards a capture interrupted by navigation before publishing any refs', async () => {
    const { session, mock } = setup()
    const fallback = mock.debugger.sendCommand.getMockImplementation()!
    mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'DOMSnapshot.captureSnapshot')
        mock.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'document-2' } })
      return fallback(method, params)
    })
    await expect(session.snapshot()).rejects.toMatchObject({ code: 'stale_ref' })
    expect(() => session.resolveRef('e1')).toThrow('stale_ref')
  })

  it('keeps scoped observations out of the full-page diff baseline', async () => {
    const { session } = setup()
    await session.snapshot()
    expect((await session.snapshot({ scope: 'e2' })).text).toContain('1 interactive / 1 total')
    expect((await session.snapshot()).text).toBe('(no change)')
  })

  it('emits changed values, new nodes and removals without returning unchanged lines', async () => {
    const { session, raw } = setup()
    await session.snapshot()
    raw.ax[2].value = { value: 'Bob' }
    expect((await session.snapshot()).text).toContain('value="Bob"')
    raw.viewport.y = 5000
    expect((await session.snapshot()).text).toContain('Below')
    expect(session.resolveRef('e1')).toBe(2)
  })

  it('suppresses values and editable descendants when large pages omit DOM capture', () => {
    const raw = fixture()
    raw.dom = undefined
    const tree = buildSnapshotTree(raw, (id) => `e${id}`)
    expect(tree.nodes.map((node) => node.name)).toContain('Below')
    expect(JSON.stringify(tree.nodes)).not.toContain('SECRET')
    expect(tree.nodes.every((node) => node.value === undefined)).toBe(true)
  })

  it('caps full and diff outputs at complete lines and falls back on large churn', () => {
    const tree = buildSnapshotTree(fixture(), (id) => `e${id}`)
    const nodes = Array.from({ length: 400 }, (_, i) => ({
      ...tree.nodes[1],
      backendNodeId: i + 1,
      ref: `e${i + 1}`,
      name: 'x'.repeat(200)
    }))
    const snapshot = {
      documentId: 'doc',
      title: 'Long',
      url: 'https://example.com',
      nodes,
      omittedNodes: 0,
      truncated: false
    }
    const revision = serializeSnapshot(snapshot, 40_000)
    expect(revision.text.length).toBeLessThanOrEqual(40_000)
    expect(revision.lines.size).toBeLessThan(400)
    expect(revision.footer).toContain(`${400 - revision.lines.size} more nodes`)
    expect(snapshot.truncated).toBe(true)
    const changed = serializeSnapshot(
      { ...snapshot, nodes: nodes.map((node) => ({ ...node, name: 'changed' })) },
      40_000
    )
    expect(diffSnapshot(revision, changed, 40_000)).toBe(changed.text)
    expect(serializeSnapshot(snapshot, 256).text.length).toBeLessThanOrEqual(256)
  })

  it('marks additions and identifies removed nodes in a small diff', () => {
    const previous = {
      documentId: 'doc',
      header: 'header',
      footer: '',
      text: 'full',
      lines: new Map([
        [1, 'one'],
        [2, 'two'],
        [3, 'three'],
        [4, 'four']
      ])
    }
    const current = {
      ...previous,
      lines: new Map([
        [1, 'one'],
        [2, 'two'],
        [3, 'three'],
        [5, 'five']
      ])
    }
    expect(diffSnapshot(previous, current, 40_000)).toBe('header\n* five\n- 1 nodes removed')
  })
})
