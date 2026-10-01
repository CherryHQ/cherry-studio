import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownChunkPreview } from '../MarkdownChunkPreview'

// jsdom has no real layout, so — matching the convention in
// src/renderer/components/FilePreview/plugins/spreadsheet/__tests__/grid.render.test.tsx — the
// virtualizer reports an explicit range and the tests assert which chunks are mounted.
const mocks = vi.hoisted(() => ({
  range: [] as number[],
  useVirtualizer: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: mocks.useVirtualizer }))

const virtualizerImpl = (options: { count: number }) => ({
  getVirtualItems: () => mocks.range.map((index) => ({ key: String(index), index, start: index * 30, size: 30 })),
  getTotalSize: () => options.count * 30,
  measureElement: () => {}
})

// Six blocks of ~9 KB split into two chunks at the 24 KB budget, so each chunk is a third of the
// document and mounting only the reported range is observable.
const content = Array.from({ length: 6 }, (_, i) => `block-${i + 1} ${'x'.repeat(9_000)}`).join('\n\n')

describe('MarkdownChunkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useVirtualizer.mockImplementation(virtualizerImpl)
  })

  it('mounts only the chunks the virtualizer reports', async () => {
    mocks.range = [0]

    render(<MarkdownChunkPreview content={content} id="doc" />)

    expect(await screen.findByText(/block-1/)).toBeInTheDocument()
    expect(screen.queryByText(/block-4/)).not.toBeInTheDocument()
  })

  it('mounts the newly reported chunks and drops the ones scrolled away', async () => {
    mocks.range = [1]

    render(<MarkdownChunkPreview content={content} id="doc" />)

    expect(await screen.findByText(/block-4/)).toBeInTheDocument()
    expect(screen.queryByText(/block-1/)).not.toBeInTheDocument()
  })
})
