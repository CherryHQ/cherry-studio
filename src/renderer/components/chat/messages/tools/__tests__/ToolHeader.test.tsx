import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ToolHeader from '../ToolHeader'

describe('ToolHeader', () => {
  it('shows the next valid description field when an extension returns an object description', () => {
    render(
      <ToolHeader
        toolName="custom_lookup"
        args={{ description: { toString: null }, query: 'Find the deployment report' }}
        showStatus={false}
      />
    )

    expect(screen.getByText('Find the deployment report')).toBeInTheDocument()
  })
})
