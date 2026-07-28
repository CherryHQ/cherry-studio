import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InputBar from '../InputBar'

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

describe('InputBar', () => {
  it('stays transparent in both light and dark themes', () => {
    render(
      <InputBar
        text=""
        referenceText=""
        placeholder="Ask a model"
        loading
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText('Ask a model')).toHaveClass(
      'rounded-none',
      'bg-transparent',
      'dark:bg-transparent'
    )
  })
})
