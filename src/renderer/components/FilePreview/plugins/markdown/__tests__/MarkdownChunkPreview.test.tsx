import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownChunkPreview } from '../MarkdownChunkPreview'
import type { MarkdownChunk } from '../markdownChunks'

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

// Two chunks of three blocks each, so mounting only the reported range is observable. The split
// itself is `markdownChunks`' contract; this component windows whatever it is handed.
const chunkOf = (labels: string[]): MarkdownChunk => ({
  text: labels.map((label) => `${label} ${'x'.repeat(9_000)}`).join('\n\n'),
  lines: labels.length * 2 - 1
})
const chunks = [chunkOf(['block-1', 'block-2', 'block-3']), chunkOf(['block-4', 'block-5', 'block-6'])]

describe('MarkdownChunkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useVirtualizer.mockImplementation(virtualizerImpl)
  })

  it('mounts only the chunks the virtualizer reports', async () => {
    mocks.range = [0]

    render(<MarkdownChunkPreview chunks={chunks} id="doc" />)

    expect(await screen.findByText(/block-1/)).toBeInTheDocument()
    expect(screen.queryByText(/block-4/)).not.toBeInTheDocument()
  })

  it('mounts the newly reported chunks and drops the ones scrolled away', async () => {
    mocks.range = [1]

    render(<MarkdownChunkPreview chunks={chunks} id="doc" />)

    expect(await screen.findByText(/block-4/)).toBeInTheDocument()
    expect(screen.queryByText(/block-1/)).not.toBeInTheDocument()
  })
})
