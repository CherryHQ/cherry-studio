import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MermaidRenderRequest } from '@renderer/types/mermaid'

import MermaidPreview from '../MermaidPreview'

const mocks = vi.hoisted(() => ({ resolveMermaidTheme: vi.fn() }))

vi.mock('@cherrystudio/ui/mermaid', () => ({
  resolveMermaidTheme: mocks.resolveMermaidTheme
}))

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: () => ({ pan: vi.fn(), zoom: vi.fn(), copy: vi.fn(), download: vi.fn(), dialog: vi.fn() })
}))

class FakeWorker {
  static current: FakeWorker
  pending: MermaidRenderRequest[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor() {
    FakeWorker.current = this
  }
  postMessage(request: MermaidRenderRequest) {
    this.pending.push(request)
  }
  reply(result: { svg: string } | { error: string }) {
    const request = this.pending.shift()!
    this.onmessage?.({ data: { id: request.id, ...result } } as MessageEvent)
  }
}

const source = 'flowchart LR\nA-->B'
const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text>${label}</text></svg>`
const host = (container: HTMLElement) => container.querySelector<HTMLDivElement>('.mermaid')!
const mounted = (container: HTMLElement) => host(container).shadowRoot?.querySelector('svg')
const startRender = () =>
  act(() => {
    vi.advanceTimersByTime(300)
  })
const reply = (label: string) => act(async () => FakeWorker.current.reply({ svg: svg(label) }))

describe('MermaidPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    mocks.resolveMermaidTheme.mockReturnValue({
      appearance: 'dark',
      roles: {},
      seriesPalette: [],
      fontFamily: 'Inter',
      fontSize: '14px'
    })
  })

  afterEach(async () => {
    cleanup()
    await act(async () => {
      while (FakeWorker.current?.pending.length) FakeWorker.current.reply({ svg: svg('cleanup') })
    })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('mounts the worker SVG and never enlarges a contained diagram past its own height', async () => {
    const { container } = render(<MermaidPreview fit="contain">{source}</MermaidPreview>)
    startRender()
    await reply('A to B')

    expect(mounted(container)).toHaveTextContent('A to B')
    expect(mounted(container)?.style.maxHeight).toBe('80px')
  })

  it('keeps the last good diagram when a newer source fails to render', async () => {
    const { container, rerender } = render(<MermaidPreview>{source}</MermaidPreview>)
    startRender()
    await reply('first')
    rerender(<MermaidPreview>{'flowchart LR\nA-->'}</MermaidPreview>)
    startRender()
    await act(async () => FakeWorker.current.reply({ error: 'parse error' }))

    expect(screen.getByText('parse error')).toBeInTheDocument()
    expect(mounted(container)).toHaveTextContent('first')
  })

  it.each(['flowchart LR\nB-->C', ''])('ignores a pending SVG when the source changes to %j', async (nextSource) => {
    const { container, rerender } = render(<MermaidPreview>{source}</MermaidPreview>)
    startRender()
    await reply('last good')
    rerender(<MermaidPreview>{'flowchart LR\nA-->C'}</MermaidPreview>)
    startRender()
    rerender(<MermaidPreview>{nextSource}</MermaidPreview>)

    await reply('obsolete')

    expect(mounted(container)).toHaveTextContent('last good')
    if (nextSource) {
      startRender()
      await reply('latest')
      expect(mounted(container)).toHaveTextContent('latest')
    }
  })

  it('ignores a pending SVG after the renderer options change', async () => {
    const { container, rerender } = render(<MermaidPreview>{source}</MermaidPreview>)
    startRender()
    rerender(<MermaidPreview fit="contain">{source}</MermaidPreview>)

    await reply('obsolete width render')

    expect(mounted(container)?.textContent).toBeUndefined()
    startRender()
    await reply('contained')
    expect(mounted(container)).toHaveTextContent('contained')
    expect(mounted(container)?.style.maxHeight).toBe('80px')
  })

  it('mounts the newest SVG when the service coalesces queued source changes', async () => {
    const { container, rerender } = render(<MermaidPreview>{source}</MermaidPreview>)
    startRender()
    rerender(<MermaidPreview>{'flowchart LR\nB-->C'}</MermaidPreview>)
    startRender()
    rerender(<MermaidPreview>{'flowchart LR\nC-->D'}</MermaidPreview>)
    startRender()

    await reply('obsolete running render')
    expect(mounted(container)?.textContent).toBeUndefined()
    expect(FakeWorker.current.pending[0].source).toBe('flowchart LR\nC-->D')
    await reply('latest coalesced render')
    expect(mounted(container)).toHaveTextContent('latest coalesced render')
  })

  it('does not write a pending SVG into an unmounted preview', async () => {
    const { container, unmount } = render(<MermaidPreview>{source}</MermaidPreview>)
    startRender()
    const detachedHost = host(container)
    unmount()

    await reply('obsolete')

    expect(detachedHost.shadowRoot?.querySelector('svg')?.textContent).toBeUndefined()
  })
})
