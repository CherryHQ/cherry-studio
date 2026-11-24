import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalAgentIcon } from '../LocalAgentIcon'

afterEach(() => {
  cleanup()
})

describe('LocalAgentIcon', () => {
  it.each<{
    label: string
    props: { presetId?: string; cliId?: string }
    expectedViewBox?: string
    expectedClasses?: string[]
  }>([
    { label: 'claude preset', props: { presetId: 'claude' } },
    { label: 'cline preset', props: { presetId: 'cline' } },
    { label: 'glm-acp-agent preset', props: { presetId: 'glm-acp-agent' } },
    { label: 'trae preset', props: { presetId: 'trae' } },
    {
      label: 'openclaw cli',
      props: { cliId: 'openclaw' },
      expectedViewBox: '12 10 96 96',
      expectedClasses: ['[&>path:first-child]:hidden']
    },
    {
      label: 'minimax cli',
      props: { cliId: 'minimax-code' },
      expectedViewBox: '24 24 72 72',
      expectedClasses: ['[&>path:first-child]:hidden', '[&>path:nth-child(2)]:fill-current']
    }
  ])(
    'renders transparent glyph artwork ($label) inside a rounded square card',
    ({ props, expectedViewBox, expectedClasses }) => {
      const { container } = render(<LocalAgentIcon {...props} size={36} variant="card" />)

      const slots = container.querySelectorAll('[data-slot="cli-icon"]')
      expect(slots).toHaveLength(1)
      expect(container.querySelector('.blur-sm')).toBeNull()

      const slot = slots[0] as HTMLElement
      expect(slot).toHaveAttribute('data-variant', 'card')
      expect(slot).toHaveClass('rounded-[22%]', 'overflow-hidden', 'bg-background', 'dark:bg-card', 'text-foreground')
      expect(slot).not.toHaveClass('bg-muted', 'rounded-full')
      expect(slot).toHaveStyle({ width: '36px', height: '36px' })

      const svg = slot.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveClass('size-[70%]', ...(expectedClasses ?? []))
      if (expectedViewBox) {
        expect(svg).toHaveAttribute('viewBox', expectedViewBox)
      }
    }
  )

  it.each([
    { label: 'hermes cli', props: { cliId: 'hermes' }, expectedViewBox: '0 0 120 120' },
    { label: 'zcode preset', props: { presetId: 'zcode' } },
    { label: 'snow preset', props: { presetId: 'snow' } },
    { label: 'kiro preset', props: { presetId: 'kiro' } },
    { label: 'codebuddy-code preset', props: { presetId: 'codebuddy-code' } },
    { label: 'kimi preset via kimi-code', props: { presetId: 'kimi' }, expectedViewBox: '20 23 77 77' },
    { label: 'codex preset via openai-codex', props: { presetId: 'codex' } }
  ])('frames full-bleed tile artwork ($label) in a matching rounded square card', ({ props, expectedViewBox }) => {
    const { container } = render(<LocalAgentIcon {...props} size={32} variant="card" />)

    const slots = container.querySelectorAll('[data-slot="cli-icon"]')
    expect(slots).toHaveLength(1)
    expect(container.querySelector('.blur-sm')).toBeNull()

    const slot = slots[0] as HTMLElement
    expect(slot).toHaveAttribute('data-variant', 'card')
    expect(slot).toHaveClass('rounded-[22%]', 'overflow-hidden')
    expect(slot).not.toHaveClass('bg-background', 'bg-muted', 'rounded-full')
    expect(slot).toHaveStyle({ width: '32px', height: '32px' })

    const svg = slot.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('size-full')
    if (expectedViewBox) {
      expect(svg).toHaveAttribute('viewBox', expectedViewBox)
    }
  })

  it('renders a Terminal fallback card when no preset or cli id is provided', () => {
    const { container } = render(<LocalAgentIcon size={28} variant="card" />)

    expect(container.querySelector('[data-slot="cli-icon"]')).toBeNull()
    expect(container.querySelector('.blur-sm')).toBeNull()

    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveClass('rounded-[22%]', 'bg-background', 'dark:bg-card', 'text-foreground', 'ring-1')
    expect(avatar).not.toHaveClass('bg-muted')
    expect(avatar).toHaveStyle({ width: '28px', height: '28px' })
    expect(avatar.querySelector('svg')).not.toBeNull()
  })

  it('uses a circular frame for a named agent and for the generic local avatar', () => {
    const { container, rerender } = render(<LocalAgentIcon presetId="codex" size={24} />)
    // Avatar call sites share the circular frame even for full-tile artwork.
    expect(container.querySelector('[data-slot="cli-icon"]')).toHaveClass('rounded-full', 'overflow-hidden')
    expect(container.querySelector('svg')).toHaveStyle({ width: '24px', height: '24px' })

    rerender(<LocalAgentIcon size={24} />)
    expect(screen.getByTestId('avatar')).toHaveClass('rounded-full')
    expect(container.querySelector('svg.lucide-terminal')).toBeInTheDocument()
  })
})
