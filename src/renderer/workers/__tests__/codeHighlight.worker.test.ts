import { afterAll, describe, expect, it, vi } from 'vitest'

import type { HighlightRequest, HighlightResponse } from '@renderer/types/codeHighlight'

const replies = new Map<number, (response: HighlightResponse) => void>()
const host = {
  onmessage: (_event: { data: HighlightRequest & { id: number; generation: number } }) => {
    void _event
  },
  postMessage: (response: HighlightResponse) => {
    replies.get(response.id)?.(response)
    replies.delete(response.id)
  }
}
vi.stubGlobal('self', host)
await import('../codeHighlight.worker')
afterAll(() => vi.unstubAllGlobals())
let id = 0
function request(input: HighlightRequest) {
  return new Promise<HighlightResponse>((resolve) => {
    const next = id++
    replies.set(next, resolve)
    host.onmessage({ data: { ...input, id: next, generation: 7 } })
  })
}
const open = (sessionId: string, code = 'const a = 1') =>
  request({ type: 'open', sessionId, code, language: 'ts', theme: 'one-light', revision: 0, configurationRevision: 0 })
const read = (sessionId: string, revision = 0) =>
  request({ type: 'read', sessionId, revision, configurationRevision: 0, range: { start: 0, end: 5 } })

describe('highlight worker document protocol', () => {
  it('exports escaped HTML and fenced or indented Markdown through the shared syntax parser', async () => {
    const code = 'const value = "<script>中文 🥟</script>";\r\n'
    const html = await request({ type: 'html', code, language: 'ts', theme: 'one-light' })
    if (!('result' in html) || typeof html.result !== 'string') throw new Error('Expected HTML')
    const container = document.createElement('div')
    container.innerHTML = html.result
    expect(container.querySelector('code')?.textContent).toBe(code)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('span')?.style.color).toBeTruthy()
    const markdown = await request({
      type: 'markdown',
      code: '> ```ts\n> const nested = 1\n> ```\n\n    plain <tag>\n',
      theme: 'one-light'
    })
    if (!('result' in markdown) || typeof markdown.result !== 'string') throw new Error('Expected Markdown HTML')
    container.innerHTML = markdown.result
    expect(container.querySelector('blockquote code')?.textContent).toBe('const nested = 1\n')
    expect(Array.from(container.querySelectorAll('code'), (node) => node.textContent)).toEqual([
      'const nested = 1\n',
      'plain <tag>\n'
    ])
    expect(container.querySelector('tag')).toBeNull()
  })

  it('orders open, delta and read and rejects stale edits without corrupting the current source', async () => {
    const first = open('ordered')
    const update = request({
      type: 'update',
      sessionId: 'ordered',
      baseRevision: 0,
      revision: 1,
      change: {
        type: 'edits',
        edits: [{ range: { start: { line: 0, character: 11 }, end: { line: 0, character: 11 } }, newText: '\n// 🍒' }]
      }
    })
    const result = read('ordered', 1)
    expect(await first).toMatchObject({ result: null, generation: 7 })
    expect(await update).toMatchObject({ result: null })
    const response = await result
    expect(response).toMatchObject({ sessionId: 'ordered', revision: 1, configurationRevision: 0 })
    expect(
      'result' in response &&
        response.result &&
        typeof response.result !== 'string' &&
        'lines' in response.result &&
        response.result.lines.map((line) => line.map((token) => token.content).join('')).join('\n')
    ).toBe('const a = 1\n// 🍒')
    expect(
      await request({
        type: 'update',
        sessionId: 'ordered',
        baseRevision: 0,
        revision: 2,
        change: { type: 'replace', code: 'corrupted' }
      })
    ).toHaveProperty('error')
    if (!('result' in response)) throw new Error('Expected successful read')
    expect(await read('ordered', 1)).toMatchObject({ result: response.result })
    await request({ type: 'close', sessionId: 'ordered' })
    expect(await read('ordered', 1)).toMatchObject({ missing: true })
  })
  it('evicts beyond 50 sessions and permits reopening the latest source', async () => {
    for (let i = 0; i < 51; i++) await open(`lru-${i}`)
    expect(await read('lru-0')).toMatchObject({ missing: true })
    await open('lru-0', 'const reopened = 2')
    expect(await read('lru-0')).toHaveProperty('result')
    for (let i = 0; i < 51; i++) await request({ type: 'close', sessionId: `lru-${i}` })
  })
})
