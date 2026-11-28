import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlantUmlRenderResponse } from '@renderer/workers/plantUml.worker'

import PlantUmlPreview from '../PlantUmlPreview'
import { usePreviewImageReady } from '../usePreviewImageReady'

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: () => ({ pan: vi.fn(), zoom: vi.fn(), copy: vi.fn(), download: vi.fn(), dialog: vi.fn() })
}))

class FakeWorker {
  static current: FakeWorker | undefined
  onmessage: ((event: MessageEvent<PlantUmlRenderResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage() {}
  terminate() {
    FakeWorker.current = undefined
  }
  constructor() {
    FakeWorker.current = this
  }
}

const source = '@startuml\nAlice -> Bob\n@enduml'
const nextSource = '@startuml\nBob -> Carol\n@enduml'
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">${body}</svg>`
const getHost = (container: HTMLElement) => container.querySelector<HTMLDivElement>('.plantuml-preview')!
const advance = (ms = 300) => act(() => vi.advanceTimersByTimeAsync(ms))
const reply = (data: PlantUmlRenderResponse) =>
  act(async () => {
    FakeWorker.current?.onmessage?.(new MessageEvent('message', { data }))
  })

describe('PlantUmlPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(async () => {
    cleanup()
    await act(async () => {})
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the local SVG without attaching elements that automatically load external resources', async () => {
    const { container } = render(<PlantUmlPreview>{source}</PlantUmlPreview>)
    await advance()
    await reply({
      svg: svg(
        '<text>Alice to Bob</text><image href="https://example.invalid/image.png"/><style>@import "https://example.invalid/diagram.css";</style>'
      )
    })

    const diagram = getHost(container).shadowRoot?.querySelector('svg')
    expect(diagram).toHaveTextContent('Alice to Bob')
    expect(diagram?.querySelector('image, style')).toBeNull()
  })

  it('reports image readiness through onImageReadyChange', async () => {
    const onImageReadyChange = vi.fn()
    const { rerender } = render(<PlantUmlPreview onImageReadyChange={onImageReadyChange}>{source}</PlantUmlPreview>)
    expect(onImageReadyChange).toHaveBeenLastCalledWith(false)

    await advance()
    await reply({ svg: svg('<text>Alice to Bob</text>') })
    expect(onImageReadyChange).toHaveBeenLastCalledWith(true)

    rerender(<PlantUmlPreview onImageReadyChange={onImageReadyChange}>{nextSource}</PlantUmlPreview>)
    expect(onImageReadyChange).toHaveBeenLastCalledWith(false)

    await advance()
    await reply({ error: 'Cannot include diagram' })
    expect(onImageReadyChange).toHaveBeenLastCalledWith(false)
  })

  it.each([undefined, '', '   '])('does not report ready when the engine supplies no SVG: %j', async (missingSvg) => {
    const onImageReadyChange = vi.fn()
    const { container } = render(<PlantUmlPreview onImageReadyChange={onImageReadyChange}>{source}</PlantUmlPreview>)
    await advance()
    await reply({ svg: missingSvg } as PlantUmlRenderResponse)
    expect(getHost(container).shadowRoot?.querySelector('svg')).toBeFalsy()
    expect(onImageReadyChange).not.toHaveBeenCalledWith(true)
    expect(screen.getByText('error.render.block')).toBeInTheDocument()
  })

  it('keeps the attached diagram and render job stable across preview layout switches', async () => {
    const PreviewHost = ({ layout }: { layout: 'special' | 'split' | 'source' }) => {
      const mounted = layout !== 'source'
      const { onImageReadyChange, previewImageReady } = usePreviewImageReady(
        JSON.stringify(['plantuml', source, false, mounted]),
        true
      )
      return (
        <div data-ready={String(previewImageReady)}>
          {mounted && <PlantUmlPreview onImageReadyChange={onImageReadyChange}>{source}</PlantUmlPreview>}
        </div>
      )
    }
    const { container, rerender } = render(<PreviewHost layout="special" />)
    await advance()
    await reply({ svg: svg('<text>Preserved</text>') })
    const attached = getHost(container).shadowRoot?.querySelector('svg')
    const worker = FakeWorker.current
    expect(attached).toBeTruthy()
    rerender(<PreviewHost layout="split" />)
    expect(getHost(container).shadowRoot?.querySelector('svg')).toBe(attached)
    expect(container.firstElementChild).toHaveAttribute('data-ready', 'true')
    await advance()
    expect(FakeWorker.current).toBe(worker)
    expect(getHost(container).shadowRoot?.querySelector('svg')).toBe(attached)
    rerender(<PreviewHost layout="source" />)
    rerender(<PreviewHost layout="special" />)
    expect(container.firstElementChild).toHaveAttribute('data-ready', 'false')
    expect(getHost(container).shadowRoot?.querySelector('svg')).toBeFalsy()
  })

  it('shows the reported PlantUML error and line when the source cannot render', async () => {
    render(<PlantUmlPreview>{source}</PlantUmlPreview>)
    await advance()
    await reply({ error: 'Cannot include diagram', line: 2 })

    expect(screen.getByText('2: Cannot include diagram')).toBeInTheDocument()
  })

  it.each([nextSource, ''])('discards the obsolete result when the source changes to %j', async (next) => {
    const { container, rerender } = render(<PlantUmlPreview>{source}</PlantUmlPreview>)
    await advance()
    const obsoleteReply = FakeWorker.current?.onmessage

    rerender(<PlantUmlPreview>{next}</PlantUmlPreview>)
    await act(async () => obsoleteReply?.(new MessageEvent('message', { data: { svg: svg('<text>Obsolete</text>') } })))
    expect(getHost(container).shadowRoot?.querySelector('svg')).toBeFalsy()

    if (next) {
      await advance()
      await reply({ svg: svg('<text>Bob to Carol</text>') })
      expect(getHost(container).shadowRoot?.querySelector('svg')).toHaveTextContent('Bob to Carol')
    }
  })

  it('does not write a late SVG after leaving the preview', async () => {
    const { container, unmount } = render(<PlantUmlPreview>{source}</PlantUmlPreview>)
    await advance()
    const obsoleteReply = FakeWorker.current?.onmessage
    const host = getHost(container)
    unmount()

    await act(async () => obsoleteReply?.(new MessageEvent('message', { data: { svg: svg('<text>Obsolete</text>') } })))
    expect(host.shadowRoot?.querySelector('svg')).toBeFalsy()
  })

  it('releases a timed-out worker so the next diagram can render', async () => {
    const { container, rerender } = render(<PlantUmlPreview>{source}</PlantUmlPreview>)
    await advance()
    const timedOutWorker = FakeWorker.current

    await advance(10_000)
    expect(FakeWorker.current).toBeUndefined()

    rerender(<PlantUmlPreview>{nextSource}</PlantUmlPreview>)
    await advance()
    expect(FakeWorker.current).not.toBe(timedOutWorker)
    await reply({ svg: svg('<text>Bob to Carol</text>') })
    expect(getHost(container).shadowRoot?.querySelector('svg')).toHaveTextContent('Bob to Carol')
  })
})
