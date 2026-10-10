import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../plugins/spreadsheet/mockModel'
import type { XlsxParseRequest, XlsxParseResponse } from '../plugins/spreadsheet/renderModel'
import { Preview } from '../Preview'
import type { PreviewSelection } from '../selection'
import type { PreviewSource } from '../source'
import type { PreviewResources } from '../types'

vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

function workbookSource(): { source: PreviewSource; resources: PreviewResources } {
  const model = createMockWorkbookModel()
  model.images = {}
  for (const sheet of model.sheets) {
    sheet.charts = []
    sheet.floatingImages = []
  }
  return {
    source: {
      id: 'workbook',
      name: 'report.xlsx',
      open: async () => ({
        size: 1,
        revision: 'v1',
        readRange: async () => new Uint8Array([1]),
        close: async () => {}
      })
    },
    resources: {
      createWorker: () => {
        const worker = {
          onmessage: null as ((event: { data: XlsxParseResponse }) => void) | null,
          onerror: null,
          postMessage(request: XlsxParseRequest) {
            queueMicrotask(() => worker.onmessage?.({ data: { id: request.id, ok: true, model } }))
          },
          terminate() {}
        }
        return worker as unknown as Worker
      }
    }
  }
}

describe('spreadsheet host integration', () => {
  it('does not report a held selection again when the host recreates its callback', async () => {
    const user = userEvent.setup()
    const { source, resources } = workbookSource()
    const reported = vi.fn<(selection: PreviewSelection | null) => void>()
    function Host() {
      const [excerpt, setExcerpt] = useState('')
      return (
        <>
          <output aria-label="Held selection">{excerpt}</output>
          <Preview
            source={source}
            resources={resources}
            onSelection={(selection) => {
              reported(selection)
              setExcerpt(selection?.excerpt ?? '')
            }}
          />
        </>
      )
    }
    render(<Host />)
    const grid = await screen.findByRole('grid', { name: 'Sales' })
    grid.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Held selection')).toHaveTextContent('2026 Sales Summary')
    expect(reported).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        anchor: { format: 'xlsx', sheet: 'Sales', range: 'A1' },
        excerpt: '2026 Sales Summary'
      })
    )
  })

  it('keeps sheet tabs and zoom above the host inset when content mode is selected', async () => {
    const { source, resources } = workbookSource()
    const view = render(<Preview source={source} resources={resources} />)
    await screen.findByRole('grid', { name: 'Sales' })
    const footer = screen.getByTestId('xlsx-preview-footer')
    expect(footer.style.paddingBottom).toBe('')

    view.rerender(<Preview source={source} resources={resources} options={{ bottomInset: 'content' }} />)

    // XLSX reserves the host inset below its permanent controls, outside the grid's scroll space.
    expect(footer.style.paddingBottom).toBe('calc(0.25rem + var(--file-preview-bottom-inset, 0px))')
    expect(footer).toContainElement(screen.getByRole('tab', { name: 'Sales' }))
    expect(footer).toContainElement(screen.getByRole('button', { name: 'Zoom In' }))
    expect(screen.getByRole('grid', { name: 'Sales' }).style.paddingBottom).toBe('')
  })
})
