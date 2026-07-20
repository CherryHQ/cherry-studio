import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SelectionToolbarView from '../SelectionToolbarView'

vi.mock('@renderer/assets/images/logo.png', () => ({ default: 'logo.png' }))

describe('SelectionToolbarView surface', () => {
  it('uses an opaque card as the default toolbar background', () => {
    const { container } = render(
      <SelectionToolbarView
        actionItems={[]}
        isCompact={false}
        handleAction={vi.fn()}
        copyIconStatus="normal"
        copyIconAnimation="none"
      />
    )

    expect(container.firstElementChild?.className).toContain(
      '[background:var(--selection-toolbar-background,var(--color-card))]'
    )
    expect(container.firstElementChild?.className).not.toContain('rgb(245_245_245_/_0.95)')
    expect(container.firstElementChild?.className).not.toContain('rgb(20_20_20_/_0.95)')
  })
})
