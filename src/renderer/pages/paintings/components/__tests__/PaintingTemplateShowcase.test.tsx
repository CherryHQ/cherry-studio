import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import PaintingTemplateShowcase from '../PaintingTemplateShowcase'

const templates = Array.from({ length: 7 }, (_, index) => ({
  id: `template-${index + 1}`,
  imageUrl: `/template-${index + 1}.webp`,
  label: `Template ${index + 1}`,
  prompt: `Prompt ${index + 1}`
}))

describe('PaintingTemplateShowcase', () => {
  it('centers a selected template and fills its prompt', () => {
    const onSelect = vi.fn()
    render(<PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={templates} onSelect={onSelect} />)

    const templateButton = screen.getByRole('button', { name: 'Template 2' })
    fireEvent.click(templateButton)

    expect(onSelect).toHaveBeenCalledWith('Prompt 2')
    expect(templateButton).toHaveAttribute('aria-pressed', 'true')
    expect(templateButton).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
      'focus-visible:ring-muted-foreground',
      'shadow-md'
    )
    expect(templateButton.className).not.toMatch(/focus-visible:outline-offset-[1-9]/)
    expect(templateButton).toHaveStyle({
      transform: 'translate(-50%, calc(-50% - 2px)) rotate(0deg) scale(1.12)'
    })
  })

  it('uses the current prompt to select the matching template', () => {
    render(
      <PaintingTemplateShowcase paintingId="painting-1" prompt="Prompt 2" templates={templates} onSelect={vi.fn()} />
    )

    expect(screen.getByRole('group', { name: 'paintings.showcase.styles_label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Template 2' })).toHaveAttribute('aria-pressed', 'true')
  })
})
