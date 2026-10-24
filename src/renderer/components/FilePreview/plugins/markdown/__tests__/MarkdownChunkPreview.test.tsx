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

  it('keys a heading on the text the sanitizer keeps, so a stripped element leaves no residue', async () => {
    // `style` is stripped with its content, so `# A<style>bad</style>B` renders `AB`; keying it on
    // `abadb` left the later `# AB` without the `-1` the unsplit document gives it.
    const content = ['# A<style>bad</style>B', '', 'first', '', '# AB'].join('\n')
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="sanitized-style" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['ab', 'ab-1'])
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

  it('keys a heading on the footnote number the renderer prints, so a repeated heading keeps its id', async () => {
    // The renderer turns a defined `[^n]` into a superscript number, so the text its heading id is
    // numbered from is `Foo1`, not `Foo[^n]`. Keying the assignment on the source text missed that
    // key, both chunks fell back to their own counter, and both headings took `--foo1`.
    const content = ['# Foo[^n]', '', 'first', '', '# Foo[^n]', '', '[^n]: note'].join('\n')
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="footnote-number" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['foo1', 'foo1-1'])
  })

  it('keys a heading on the code span the renderer prints, padding removed', async () => {
    // CommonMark drops one space from each end of a code span that carries both, so `# foo` bar `baz`
    // renders `foobarbaz`. Keeping the padding keyed the heading on `foo-bar-baz` and left the later
    // `# foobarbaz` without the `-1` its link names.
    const filler = 'filler\n\n'.repeat(3072)
    const content = `# foo\` bar \`baz\n\n${filler}# foobarbaz\n\n[jump](#foobarbaz-1)\n`
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="code-span-padding" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['foobarbaz', 'foobarbaz-1'])
  })

  it('finds a closer past a longer backtick run, so duplicate heading ids stay distinct', async () => {
    // The two-backtick run inside the span is content; stopping there left the heading keyed by the
    // raw span text, so both chunks numbered the same id and the fragment link had no target.
    const filler = 'filler\n\n'.repeat(3072)
    const content = `# a\`b\`\`*c*\`d\n\n${filler}# ab-c-d\n\n[jump](#ab-c-d-1)\n`
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="backtick-runs" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['ab-c-d', 'ab-c-d-1'])
  })

  it('keeps an intraword underscore literal when keying heading slugs', async () => {
    // Underscores between word characters are text; treating them as emphasis dropped them from the
    // key, so both chunks fell back to the same rendered suffix and the fragment link had no target.
    const filler = 'filler\n\n'.repeat(3072)
    const content = `# my_file_name\n\n${filler}# my_file_name\n\n[jump](#my-file-name-1)\n`
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="intraword-underscore" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['my-file-name', 'my-file-name-1'])
  })

  it('keys a heading on the number its own chunk gives a footnote', async () => {
    // A chunk numbers the notes it carries from one, so `# Foo[^b]` here renders `Foo1` even though
    // the document numbers it second. The assignment has to be keyed the way this chunk renders it.
    const filler = 'filler\n\n'.repeat(3072)
    const content = `opening[^a]\n\n${filler}# Foo[^b]\n\n# Foo2\n\n[jump](#foo2-1)\n\n[^a]: note a\n\n[^b]: note b\n`
    const chunks = splitMarkdownChunks(content, 1).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="local-footnote-number" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['foo2', 'foo2-1'])
  })

  it('leaves an undefined footnote reference out of the number a heading is keyed on', async () => {
    // `[^missing]` has no definition, so it stays literal text and `[^n]` is note 1: `Title[^n]`
    // renders `Title1`, the duplicate of the `# Title1` above it, and takes `-1`. Numbering the
    // undefined reference first keyed the heading `title2`, so it fell past `title1` and `title1-1`
    // to `title1-2` — the id `[jump](#title1-1)` names.
    const content = ['# Title1', '', '[^missing]', '', '# Title[^n]', '', '[jump](#title1-1)', '', '[^n]: note'].join(
      '\n'
    )
    const chunks = splitMarkdownChunks(content).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="undefined-footnote" />)

    const ids = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['title1', 'title1-1'])
  })

  it('reads a heading tag to its real terminator, so a quoted `>` keeps the heading text', async () => {
    // The attribute value holds a `>`; ending the tag there named the first heading `b-title`, which
    // left the later `# Title` unnumbered — both rendered `title` and the `#title-1` link had no
    // target even with every chunk mounted.
    const filler = 'filler\n\n'.repeat(3072)
    const content = `<h2 title="a>b">Title</h2>\n\n${filler}# Title\n\n[jump](#title-1)\n`
    const chunks = splitMarkdownChunks(content).chunks
    mocks.range = chunks.map((_, index) => index)
    const { container } = render(<MarkdownChunkPreview chunks={chunks} id="quoted-attribute" />)

    const ids = Array.from(container.querySelectorAll('h1, h2')).map((heading) => heading.getAttribute('id'))

    expect(ids.map((id) => id?.split('--')[1])).toEqual(['title', 'title-1'])
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
