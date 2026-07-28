import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import NarrowLayout from '../NarrowLayout'

describe('NarrowLayout', () => {
  it('uses full width when narrow mode is disabled', () => {
    render(<NarrowLayout narrowMode={false}>Content</NarrowLayout>)

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('max-w-full')
    expect(layout).not.toHaveClass('max-w-[800px]')
    expect(layout).not.toHaveClass('active')
  })

  it('uses the narrow max width when narrow mode is enabled', () => {
    render(<NarrowLayout narrowMode>Content</NarrowLayout>)

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('active', 'max-w-[800px]')
    expect(layout).not.toHaveClass('max-w-full')
  })

  it('keeps side padding outside the narrow content width when requested', () => {
    render(
      <NarrowLayout narrowMode withSidePadding>
        Content
      </NarrowLayout>
    )

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('active', 'max-w-[calc(800px+3rem)]', 'box-border', 'px-6')
    expect(layout).not.toHaveClass('box-content')
  })

  it('keeps default side padding in wide layout when requested', () => {
    render(<NarrowLayout withSidePadding>Content</NarrowLayout>)

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('max-w-full', 'box-border', 'px-6')
    expect(layout).not.toHaveClass('box-content')
    expect(layout).not.toHaveClass('active')
  })
})
