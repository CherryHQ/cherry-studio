import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Preview } from '../Preview'
import type { PreviewOptions } from '../types'
import { previewTestDocument } from './previewTestDocument'

vi.unmock('@cherrystudio/ui')
vi.mock('docx-preview', () => ({
  renderAsync: async (_data: Uint8Array, body: HTMLElement) => {
    body.innerHTML = '<div><section>Portrait page</section><section>Landscape page</section></div>'
  }
}))

let viewportWidth = 380
const resizeCallbacks = new Set<() => void>()

beforeEach(() => {
  viewportWidth = 380
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? viewportWidth : 0
  })
  // The layout boundary supplies a widest page plus its wrapper padding, independent of CSS zoom.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'docx-preview-content' ? 1000 : 0
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback)
      }
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.callback)
      }
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  resizeCallbacks.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createSource() {
  const bytes = new Uint8Array(22)
  new DataView(bytes.buffer).setUint32(0, 0x06054b50, true)
  const document = previewTestDocument(22, 1, async () => bytes)
  const open = vi.fn().mockResolvedValue(document)
  return { id: 'layout', name: 'layout.docx', open }
}

function resize(width: number) {
  act(() => {
    viewportWidth = width
    for (const callback of resizeCallbacks) callback()
  })
}

describe('host preview options', () => {
  it('keeps desktop actual-size zoom at narrow widths when no options are supplied', async () => {
    render(<Preview source={createSource()} />)
    await screen.findByText('Landscape page')
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('100%')
    resize(780)
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('100%')
  })

  it('moves the inset from the outer viewport to the unscaled document scroll region only when requested', async () => {
    const source = createSource()
    const view = render(<Preview source={source} />)
    await screen.findByText('Landscape page')
    const region = screen.getByRole('region', { name: 'layout.docx' })
    // Inset ownership is the layout contract: outer padding creates the reported fixed strip.
    expect(screen.getByTestId('file-preview-content')).toHaveClass('pb-[var(--file-preview-bottom-inset,0px)]')
    expect(region.style.paddingBottom).toBe('')

    view.rerender(<Preview source={source} options={{ bottomInset: 'content' }} />)
    expect(screen.getByTestId('file-preview-content')).not.toHaveClass('pb-[var(--file-preview-bottom-inset,0px)]')
    expect(region.style.paddingBottom).toBe('var(--file-preview-bottom-inset, 0px)')
    expect(screen.getByTestId('docx-preview-content').style.paddingBottom).toBe('')
    expect(source.open).toHaveBeenCalledTimes(1)
  })

  it('fits below 50%, follows rotation, and keeps manual zoom until reset without reopening the source', async () => {
    const user = userEvent.setup()
    const source = createSource()
    const options: PreviewOptions = { bottomInset: 'content', docx: { initialZoom: 'fit-width' } }
    const view = render(<Preview source={source} options={options} />)
    await screen.findByText('Landscape page')
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('38%')

    resize(780)
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('78%')
    await user.click(screen.getByRole('button', { name: 'Zoom In' }))
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('88%')
    resize(500)
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('88%')

    view.rerender(
      <Preview source={source} options={{ ...options, pdf: { outlineLayout: 'panel' } }} className="dark" />
    )
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('88%')
    expect(source.open).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('50%')
    resize(380)
    expect(screen.getByTestId('docx-preview-zoom-value')).toHaveTextContent('38%')
  })
})
