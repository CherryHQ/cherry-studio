import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SheetRenderModel } from '../renderModel'
import XlsxGrid from '../XlsxGrid'

// Supply only browser geometry; retain the real React virtualizer and its measurement cache.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
})

afterEach(() => vi.restoreAllMocks())

const makeSheet = (rowSize: number, colSize: number): SheetRenderModel => ({
  name: 'Sheet',
  hidden: false,
  rowCount: 120,
  colCount: 60,
  defaultRowHeightPx: 20,
  defaultColWidthPx: 50,
  rowHeightsPx: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [i + 1, rowSize])),
  colWidthsPx: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i + 1, colSize])),
  cells: {
    '51:21': { text: 'Original viewport' },
    '11:5': { text: 'Resized viewport' }
  },
  merges: [],
  floatingImages: [],
  charts: []
})

describe('XlsxGrid real virtualization', () => {
  it('recomputes visible cells after same-count row and column dimensions change without resetting scroll', () => {
    const view = render(<XlsxGrid sheet={makeSheet(20, 50)} styles={[]} imageUrls={{}} zoom={1} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')
    // jsdom cannot perform native scrolling; dispatch the scroll event at the browser boundary.
    fireEvent.scroll(scroll, { target: { scrollTop: 1000, scrollLeft: 1000 } })
    expect(screen.getByText('Original viewport')).toBeInTheDocument()
    expect(screen.queryByText('Resized viewport')).not.toBeInTheDocument()

    view.rerender(<XlsxGrid sheet={makeSheet(100, 250)} styles={[]} imageUrls={{}} zoom={1} />)

    expect(screen.getByText('Resized viewport')).toBeInTheDocument()
    expect(screen.queryByText('Original viewport')).not.toBeInTheDocument()
    expect(screen.getByTestId('xlsx-grid-scroll')).toBe(scroll)
    expect(scroll.scrollTop).toBe(1000)
    expect(scroll.scrollLeft).toBe(1000)

    view.rerender(<XlsxGrid sheet={makeSheet(20, 50)} styles={[]} imageUrls={{}} zoom={1} />)
    expect(screen.getByText('Original viewport')).toBeInTheDocument()
    expect(screen.queryByText('Resized viewport')).not.toBeInTheDocument()
    expect(scroll.scrollTop).toBe(1000)
    expect(scroll.scrollLeft).toBe(1000)
  })

  it('recomputes the viewport when zoom changes with the same row and column counts', () => {
    const sheet = makeSheet(20, 50)
    sheet.cells['26:11'] = { text: 'Zoomed viewport' }
    const view = render(<XlsxGrid sheet={sheet} styles={[]} imageUrls={{}} zoom={1} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')
    fireEvent.scroll(scroll, { target: { scrollTop: 1000, scrollLeft: 1000 } })
    expect(screen.getByText('Original viewport')).toBeInTheDocument()
    expect(screen.queryByText('Zoomed viewport')).not.toBeInTheDocument()

    view.rerender(<XlsxGrid sheet={sheet} styles={[]} imageUrls={{}} zoom={2} />)
    expect(screen.getByText('Zoomed viewport')).toBeInTheDocument()
    expect(screen.queryByText('Original viewport')).not.toBeInTheDocument()
    expect(scroll.scrollTop).toBe(1000)
    expect(scroll.scrollLeft).toBe(1000)
  })
})
