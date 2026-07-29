import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CitationSup from '../CitationSup'

vi.mock('../CitationTooltip', () => ({
  __esModule: true,
  default: ({ children, citation }: { children: React.ReactNode; citation: unknown }) => (
    <span data-testid="citation-tooltip" data-citation-json={JSON.stringify(citation)}>
      {children}
    </span>
  ),
  CitationSchema: {
    safeParse: (value: unknown) =>
      value && typeof value === 'object' ? { success: true, data: value } : { success: false }
  }
}))

const citationJson = JSON.stringify({ type: 'knowledge', url: '', title: 'One.md', content: 'kb chunk' })

describe('CitationSup', () => {
  it('mounts the tooltip for a sup carrying citation data', () => {
    render(<CitationSup data-citation={citationJson}>3</CitationSup>)

    const tooltip = screen.getByTestId('citation-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(JSON.parse(tooltip.getAttribute('data-citation-json')!)).toMatchObject({
      type: 'knowledge',
      title: 'One.md'
    })
    expect(tooltip.querySelector('sup')).toHaveTextContent('3')
  })

  // Footnote refs and hand-written markup also render as <sup>; they must pass through so the
  // citation component can be registered globally for the `sup` tag.
  it('renders a plain sup untouched when there is no citation data', () => {
    render(<CitationSup>1</CitationSup>)

    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()
    expect(document.querySelector('sup')).toHaveTextContent('1')
  })

  it('renders a plain sup when the citation payload is not valid JSON', () => {
    render(<CitationSup data-citation="{not json">2</CitationSup>)

    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()
    expect(document.querySelector('sup')).toHaveTextContent('2')
  })

  it('drops the hast `node` prop so it never reaches the DOM', () => {
    render(<CitationSup node={{ position: undefined } as never} data-citation={citationJson} />)

    expect(document.querySelector('sup')).not.toHaveAttribute('node')
  })
})
