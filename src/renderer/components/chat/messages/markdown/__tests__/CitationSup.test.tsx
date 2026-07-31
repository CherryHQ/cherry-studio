import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Citation } from '@renderer/types/message'

import CitationSup from '../CitationSup'

vi.mock('../CitationTooltip', () => ({
  __esModule: true,
  default: ({ children, citation }: { children: React.ReactNode; citation: Citation }) => (
    <span data-testid="citation-tooltip" data-citation-title={citation.title}>
      {children}
    </span>
  )
}))

const knowledgeCitation: Citation = {
  number: 3,
  type: 'knowledge',
  url: '',
  title: 'One.md',
  content: 'kb chunk'
}

describe('CitationSup', () => {
  it('resolves an opaque id through the trusted registry', () => {
    render(
      <CitationSup data-citation="3" citationRegistry={new Map([[3, knowledgeCitation]])}>
        3
      </CitationSup>
    )

    const tooltip = screen.getByTestId('citation-tooltip')
    expect(tooltip).toHaveAttribute('data-citation-title', 'One.md')
    expect(tooltip.querySelector('sup')).toHaveTextContent('3')
  })

  it('mounts the tooltip for a trusted non-linkable migrated path', () => {
    const citation = { ...knowledgeCitation, number: 4, url: '/Users/me/docs/One.pdf' }
    render(
      <CitationSup data-citation="4" citationRegistry={new Map([[4, citation]])}>
        4
      </CitationSup>
    )

    expect(screen.getByTestId('citation-tooltip').querySelector('sup')).toHaveTextContent('4')
  })

  it('makes the tooltip-bearing sup a focusable, numbered trigger', () => {
    render(
      <CitationSup data-citation="3" citationRegistry={new Map([[3, knowledgeCitation]])}>
        3
      </CitationSup>
    )

    const sup = screen.getByTestId('citation-tooltip').querySelector('sup')!
    expect(sup).toHaveAttribute('role', 'button')
    expect(sup).toHaveAttribute('tabindex', '0')
    expect(sup.getAttribute('aria-label')).toContain('3')
    expect(sup).toHaveClass('focus-visible:bg-accent', 'focus-visible:outline-none')
    expect(sup).not.toHaveClass('focus-visible:ring-2', 'focus-visible:ring-primary')
  })

  it('gives different citations different accessible names', () => {
    const fourth = { ...knowledgeCitation, number: 4 }
    const registry = new Map([
      [3, knowledgeCitation],
      [4, fourth]
    ])
    render(
      <>
        <CitationSup data-citation="3" citationRegistry={registry}>
          3
        </CitationSup>
        <CitationSup data-citation="4" citationRegistry={registry}>
          4
        </CitationSup>
      </>
    )

    const [first, second] = screen.getAllByTestId('citation-tooltip').map((element) => element.querySelector('sup')!)
    expect(first.getAttribute('aria-label')).toContain('3')
    expect(second.getAttribute('aria-label')).toContain('4')
    expect(first.getAttribute('aria-label')).not.toBe(second.getAttribute('aria-label'))
  })

  it('leaves a linked citation to the anchor instead of nesting a second tooltip', () => {
    const citation = { ...knowledgeCitation, number: 1, type: 'websearch', url: 'https://a.com/x', title: 'A' }
    render(
      <CitationSup data-citation="1" citationRegistry={new Map([[1, citation]])}>
        1
      </CitationSup>
    )

    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()
    const sup = document.querySelector('sup')!
    expect(sup).not.toHaveAttribute('role')
    expect(sup).not.toHaveAttribute('tabindex')
    expect(sup).not.toHaveAttribute('aria-label')
  })

  it('does not trust a payload or id that is absent from the registry', () => {
    const { rerender } = render(<CitationSup data-citation='{"url":"https://attacker.example"}'>2</CitationSup>)
    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()

    rerender(<CitationSup data-citation="2">2</CitationSup>)
    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()
    expect(document.querySelector('sup')).toHaveTextContent('2')
  })

  it('renders an ordinary sup when there is no citation id', () => {
    render(<CitationSup>1</CitationSup>)
    expect(screen.queryByTestId('citation-tooltip')).not.toBeInTheDocument()
    expect(document.querySelector('sup')).not.toHaveAttribute('role')
  })

  it('drops renderer-only props before reaching the DOM', () => {
    render(
      <CitationSup
        node={{ position: undefined } as never}
        data-citation="3"
        citationRegistry={new Map([[3, knowledgeCitation]])}
      />
    )

    const sup = document.querySelector('sup')!
    expect(sup).not.toHaveAttribute('node')
    expect(sup).not.toHaveAttribute('citationRegistry')
  })
})
