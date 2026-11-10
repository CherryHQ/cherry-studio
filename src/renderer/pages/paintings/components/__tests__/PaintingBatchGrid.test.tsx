import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingBatchColumn } from '../../model/paintingBatch'
import PaintingBatchGrid from '../PaintingBatchGrid'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function column(overrides: Partial<PaintingBatchColumn> & { key: string }): PaintingBatchColumn {
  const { key, ...rest } = overrides
  return {
    key,
    label: `Model ${key}`,
    paintingId: null,
    status: 'done',
    files: [],
    error: null,
    request: {
      batchId: 'batch-1',
      target: { providerId: 'openai', modelId: key },
      prompt: 'a serene mountain lake',
      mode: 'generate',
      inputFiles: [],
      referencesIgnored: false,
      params: {}
    },
    ...rest
  }
}

const handlers = () => ({ onRegenerate: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() })

describe('PaintingBatchGrid', () => {
  it("shows a failed column's error inline and retries only that column", () => {
    const h = handlers()
    render(
      <PaintingBatchGrid
        {...h}
        columns={[column({ key: 'a', status: 'failed', error: 'Rate limited' }), column({ key: 'b' })]}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Rate limited')
    fireEvent.click(screen.getAllByRole('button', { name: 'common.retry' })[0])

    expect(h.onRegenerate).toHaveBeenCalledTimes(1)
    expect(h.onRegenerate).toHaveBeenCalledWith('a')
  })

  it('offers cancel instead of regenerate while a column is in flight', () => {
    const h = handlers()
    render(<PaintingBatchGrid {...h} columns={[column({ key: 'a', status: 'generating' })]} />)

    expect(screen.queryByRole('button', { name: 'common.regenerate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(h.onCancel).toHaveBeenCalledWith('a')
  })

  it('flags a column that generated without the references attached to the batch', () => {
    const base = column({ key: 'a' })
    render(
      <PaintingBatchGrid
        {...handlers()}
        columns={[{ ...base, request: { ...base.request, referencesIgnored: true } }]}
      />
    )

    expect(screen.getByText('paintings.batch.reference_unsupported')).toBeInTheDocument()
  })
})
