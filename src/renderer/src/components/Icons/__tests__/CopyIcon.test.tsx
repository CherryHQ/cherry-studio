import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CopyIcon from '../CopyIcon'

describe('CopyIcon', () => {
  it('should match snapshot with props and className', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CopyIcon className="custom-class" onClick={onClick} title="Copy to clipboard" data-testid="copy-icon" />
    )

    expect(container.firstChild).toMatchSnapshot()
  })
})
