// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../markdown'

describe('Markdown mounted blocks', () => {
  it('reports the rendered paragraph and table as two ordered content blocks', () => {
    let blocks: Element[] = []
    render(
      <Markdown id="valid-document" onBlocksMounted={(elements) => (blocks = Array.from(elements))}>
        {'Intro paragraph.\n\n| Item | Count |\n| --- | --- |\n| Apples | 3 |'}
      </Markdown>
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe(screen.getByText('Intro paragraph.', { selector: 'p' }))
    const table = screen.getByRole('table', { hidden: true })
    expect(table.textContent).toContain('Apples')
    expect(blocks[1].contains(table)).toBe(true)
  })

  it('silently skips a document with top-level text outside its block elements', () => {
    const reportedBlocks: Element[] = []
    render(
      <Markdown
        id="unwrapped-document"
        components={{ p: () => 'Unwrapped paragraph' }}
        onBlocksMounted={(elements) => reportedBlocks.push(...elements)}>
        {'# Heading\n\nParagraph'}
      </Markdown>
    )

    expect(screen.getByRole('heading', { name: 'Heading' })).not.toBeNull()
    expect(screen.getByText(/Unwrapped paragraph/)).not.toBeNull()
    expect(reportedBlocks).toEqual([])
  })
})
