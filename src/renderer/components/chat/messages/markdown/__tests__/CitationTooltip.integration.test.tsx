import type { Citation } from '@renderer/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import CitationSup from '../CitationSup'

vi.unmock('@cherrystudio/ui')

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('citation tooltip accessibility', () => {
  it('describes the focused badge from the real Radix trigger', async () => {
    const citation: Citation = {
      number: 1,
      type: 'knowledge',
      url: '',
      title: 'One.md',
      content: 'Knowledge snippet'
    }
    render(
      <CitationSup data-citation="1" citationRegistry={new Map([[1, citation]])}>
        1
      </CitationSup>
    )

    const badge = screen.getByRole('button')
    const matchesSpy = vi.spyOn(badge, 'matches').mockImplementation((selector) => selector === ':focus-visible')

    try {
      fireEvent.focus(badge)
      const tooltip = await screen.findByRole('tooltip')

      expect(badge).toHaveAttribute('aria-describedby', tooltip.id)
    } finally {
      matchesSpy.mockRestore()
    }
  })
})
