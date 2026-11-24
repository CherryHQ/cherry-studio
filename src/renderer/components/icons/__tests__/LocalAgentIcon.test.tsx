import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalAgentIcon } from '../LocalAgentIcon'

afterEach(() => {
  cleanup()
})

describe('LocalAgentIcon', () => {
  it.each([
    { label: 'zcode preset', props: { presetId: 'zcode' } },
    { label: 'snow preset', props: { presetId: 'snow' } },
    { label: 'kiro preset', props: { presetId: 'kiro' } },
    { label: 'kimi preset via kimi-code', props: { presetId: 'kimi' } },
    { label: 'codex preset via openai-codex', props: { presetId: 'codex' } },
    { label: 'direct cliId kimi-code', props: { cliId: 'kimi-code' } },
    { label: 'direct cliId openai-codex', props: { cliId: 'openai-codex' } }
  ])('renders full-bleed tile artwork in a single clean circle without blur halo for $label', ({ props }) => {
    const { container } = render(<LocalAgentIcon {...props} size={36} />)

    const slots = container.querySelectorAll('[data-slot="cli-icon"]')
    expect(slots).toHaveLength(1)
    expect(container.querySelector('.blur-sm')).toBeNull()

    const slot = slots[0] as HTMLElement
    expect(slot).toHaveClass('rounded-full', 'text-foreground')
    expect(slot).not.toHaveClass('bg-muted')
    expect(slot).toHaveStyle({ width: '36px', height: '36px' })

    const svg = slot.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('size-full')
  })

  it.each(['cline', 'glm-acp-agent', 'trae'])(
    'centers transparent glyph artwork (%s) inside a single muted circle without double scaling',
    (presetId) => {
      const { container } = render(<LocalAgentIcon presetId={presetId} size={32} />)

      const slots = container.querySelectorAll('[data-slot="cli-icon"]')
      expect(slots).toHaveLength(1)
      expect(container.querySelector('.blur-sm')).toBeNull()

      const slot = slots[0] as HTMLElement
      expect(slot).toHaveClass('rounded-full', 'bg-muted', 'text-foreground')
      expect(slot).toHaveStyle({ width: '32px', height: '32px' })

      const svg = slot.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveClass('size-[68%]')
    }
  )

  it('renders a clean circular Terminal fallback when no preset or cli id is provided', () => {
    const { container } = render(<LocalAgentIcon size={28} />)

    expect(container.querySelector('[data-slot="cli-icon"]')).toBeNull()
    expect(container.querySelector('.blur-sm')).toBeNull()

    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveClass('bg-muted', 'text-foreground')
    expect(avatar).toHaveStyle({ width: '28px', height: '28px' })
    expect(avatar.querySelector('svg')).not.toBeNull()
  })
})
