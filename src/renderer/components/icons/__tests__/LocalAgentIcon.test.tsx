import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { LocalAgentIcon } from '../LocalAgentIcon'

it.each([
  { presetId: 'claude', glyphSize: 'size-[70%]' },
  { presetId: 'codex', glyphSize: 'size-full' }
])('uses the artwork framing for $presetId cards', ({ presetId, glyphSize }) => {
  const { container } = render(<LocalAgentIcon presetId={presetId} size={36} variant="card" />)
  const card = container.querySelector('[data-slot="cli-icon"]')
  expect(card).toHaveClass('rounded-md', 'overflow-hidden')
  expect(card?.querySelector('svg')).toHaveClass(glyphSize)
})

it('falls back to the terminal icon for an unbranded Agent', () => {
  render(<LocalAgentIcon size={28} variant="card" />)
  expect(screen.getByTestId('avatar').querySelector('svg.lucide-terminal')).toBeInTheDocument()
})
