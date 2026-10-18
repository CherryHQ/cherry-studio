import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownChunkPreview } from '../MarkdownChunkPreview'
import { splitMarkdownChunks, type MarkdownChunk } from '../markdownChunks'

// jsdom has no real layout, so — matching the convention in
// src/renderer/components/FilePreview/plugins/spreadsheet/__tests__/grid.render.test.tsx — the
// virtualizer reports an explicit range and the tests assert which chunks are mounted.
const mocks = vi.hoisted(() => ({
  range: [] as number[],
  useVirtualizer: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: mocks.useVirtualizer }))

// The slug tests assert real rendered heading ids, so the markdown pipeline must be the actual
// package, not the global text stub. Everything else keeps its global mock.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

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

  it('gives duplicate headings across chunks the document-wide ids an anchor names', async () => {
    // Each chunk renders as its own document, so without shared assignments both headings would take
    // `--title` and `[second](#title-1)` would name nothing — the second keeps the document's `-1`.
    mocks.range = [0, 3]

    const content = ['# Title', '', 'first', '', '[second](#title-1)', '', '# Title', ''].join('\n')
    render(<MarkdownChunkPreview chunks={splitMarkdownChunks(content, 1).chunks} id="doc" />)

    const ids = (await screen.findAllByRole('heading')).map((heading) => heading.getAttribute('id'))

    expect(ids).toEqual(['heading-doc:0--title', 'heading-doc:3--title-1'])
  })

  it('resolves a footnote backlink inside the chunk that was clicked', async () => {
    // Each mounted chunk numbers its footnotes from the same reference, so every chunk emits the
    // same reference id and a preview-wide search always finds the first chunk's — a later chunk's
    // backlink then jumps to another chunk's definition. The click has to resolve in the container
    // it was made in first.
    const content = ['first[^n]', '', '[^n]: first note', '', 'filler', '', 'second[^n]', '', '[^n]: second note'].join(
      '\n'
    )
    mocks.range = [0, 3]

    const { container } = render(<MarkdownChunkPreview chunks={splitMarkdownChunks(content, 1).chunks} id="doc" />)

    const backlinks = await screen.findAllByRole('link')
    const withHref = backlinks.filter((link) => link.getAttribute('href') === '#user-content-fnref-n')
    // The second chunk's backlink: the one a preview-wide search sends to the first chunk's copy.
    const backlink = withHref[withHref.length - 1]
    const ownChunk = backlink.closest('.markdown') as HTMLElement
    const others = Array.from(container.querySelectorAll('.markdown')).filter((part) => part !== ownChunk)

    // The collision that makes scoping matter: the reference exists in the clicked chunk and in
    // another mounted one under the very same id.
    expect(others.length).toBeGreaterThan(0)
    expect(ownChunk.querySelectorAll('[id="user-content-user-content-fnref-n"]')).toHaveLength(1)
    expect(others.every((part) => part.querySelector('[id="user-content-user-content-fnref-n"]'))).toBe(true)

    // Clicking the last chunk's backlink scrolls to the reference in that chunk — the preview-wide
    // search used to pick the first chunk's copy, so the jump landed in another chunk entirely.
    const scrolled: Element[] = []
    // jsdom lays nothing out, so scrolling is stubbed on the prototype: the element it lands on is
    // what says which chunk the click resolved in.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element) {
        scrolled.push(this)
      }
    })

    fireEvent.click(backlink)

    expect(scrolled).toHaveLength(1)
    expect(scrolled[0].closest('.markdown')).toBe(ownChunk)
  })
})
