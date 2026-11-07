import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MermaidTheme } from '@cherrystudio/ui/mermaid'
import type { MermaidRenderRequest } from '@renderer/types/mermaid'

class FakeWorker {
  static instances: FakeWorker[] = []
  posted: MermaidRenderRequest[] = []
  terminated = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(request: MermaidRenderRequest) {
    this.posted.push(request)
  }
  terminate() {
    this.terminated = true
  }
  reply(request: MermaidRenderRequest, svg: string) {
    this.onmessage?.({ data: { id: request.id, svg } } as MessageEvent)
  }
}

const theme = {
  appearance: 'dark',
  fontFamily: 'Inter',
  fontSize: '14px',
  fontFaces: [],
  roles: {},
  seriesPalette: []
} as MermaidTheme

async function loadService() {
  vi.resetModules()
  return (await import('../MermaidRenderService')).mermaidRenderService
}

describe('MermaidRenderService', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders only the newest queued source of a diagram and gives every caller that result', async () => {
    const service = await loadService()
    const first = service.render('graph A', { theme, diagramId: 'other' })
    const older = service.render('graph B1', { theme, diagramId: 'd' })
    const newer = service.render('graph B2', { theme, diagramId: 'd' })
    const worker = FakeWorker.instances[0]

    worker.reply(worker.posted[0], '<svg>A</svg>')
    await expect(first).resolves.toBe('<svg>A</svg>')
    expect(worker.posted.map((request) => request.source)).toEqual(['graph A', 'graph B2'])

    worker.reply(worker.posted[1], '<svg>B2</svg>')
    await expect(older).resolves.toBe('<svg>B2</svg>')
    await expect(newer).resolves.toBe('<svg>B2</svg>')
  })

  it('stops a render that overruns its deadline and continues on a fresh worker', async () => {
    const { MERMAID_RENDER_DEADLINE_MS } = await import('../MermaidRenderService')
    const service = await loadService()
    const stuck = service.render('graph huge', { theme, diagramId: 'huge' })
    const next = service.render('graph small', { theme, diagramId: 'small' })
    const stuckWorker = FakeWorker.instances[0]

    vi.advanceTimersByTime(MERMAID_RENDER_DEADLINE_MS)

    await expect(stuck).rejects.toThrow('took longer')
    expect(stuckWorker.terminated).toBe(true)
    const fresh = FakeWorker.instances[1]
    expect(fresh.posted.map((request) => request.source)).toEqual(['graph small'])
    fresh.reply(fresh.posted[0], '<svg>small</svg>')
    await expect(next).resolves.toBe('<svg>small</svg>')
  })

  it('fails the current render when the worker crashes and recovers for the next one', async () => {
    const service = await loadService()
    const crashed = service.render('graph A', { theme, diagramId: 'a' })
    FakeWorker.instances[0].onerror?.({ message: 'boom' } as ErrorEvent)
    await expect(crashed).rejects.toThrow('stopped unexpectedly')

    const next = service.render('graph B', { theme, diagramId: 'b' })
    const fresh = FakeWorker.instances[1]
    fresh.reply(fresh.posted[0], '<svg>B</svg>')
    await expect(next).resolves.toBe('<svg>B</svg>')
  })
})
