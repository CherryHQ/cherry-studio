// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from '../badge'

describe('Badge', () => {
  it('provides a component-scoped feature highlight variant', () => {
    render(<Badge variant="highlight">Beta</Badge>)

    expect(screen.getByText('Beta')).toHaveClass(
      'bg-[var(--badge-highlight-surface)]',
      'text-[var(--badge-highlight-foreground)]',
      'text-[10px]',
      '[--badge-highlight-border:#8fd944]',
      '[--badge-highlight-foreground:#2e4d18]',
      '[--badge-highlight-surface:#c2ec80]',
      'dark:[--badge-highlight-border:#a0d958]',
      'dark:[--badge-highlight-foreground:#c0ec7c]',
      'dark:[--badge-highlight-surface:#2a4514]'
    )
  })
})
