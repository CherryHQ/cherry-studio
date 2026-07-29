import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import PaintingTemplateShowcase from '../PaintingTemplateShowcase'

function makeTemplates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `template-${index + 1}`,
    imageUrl: `/template-${index + 1}.webp`,
    label: `Template ${index + 1}`,
    prompt: `Prompt ${index + 1}`
  }))
}

describe('PaintingTemplateShowcase', () => {
  it('centers a selected template and fills its prompt', () => {
    const onSelect = vi.fn()
    render(
      <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(7)} onSelect={onSelect} />
    )

    const templateButton = screen.getByRole('button', { name: 'Template 2' })
    fireEvent.click(templateButton)

    expect(onSelect).toHaveBeenCalledWith('Prompt 2')
    expect(templateButton).toHaveAttribute('aria-pressed', 'true')
    expect(templateButton).toHaveClass('focus-visible:outline-muted-foreground', 'shadow-md')
    expect(templateButton).toHaveStyle({
      transform: 'translate(-50%, calc(-50% - 2px)) rotate(0deg) scale(1.12)'
    })
  })

  it('uses the current prompt to select the matching template', () => {
    render(
      <PaintingTemplateShowcase
        paintingId="painting-1"
        prompt="Prompt 2"
        templates={makeTemplates(7)}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('group', { name: 'paintings.showcase.styles_label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Template 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  describe('visibility boundary', () => {
    it('renders at most 5 template buttons for a 25-template catalog', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(25)} onSelect={vi.fn()} />
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(5)
    })

    it('renders at most 5 images for a 25-template catalog', () => {
      const { container } = render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(25)} onSelect={vi.fn()} />
      )

      const images = container.querySelectorAll('img')
      expect(images).toHaveLength(5)
    })

    it('renders all templates when catalog has fewer than 5', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(3)} onSelect={vi.fn()} />
      )

      expect(screen.getAllByRole('button')).toHaveLength(3)
    })

    it('renders exactly 5 templates when catalog has exactly 5', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(5)} onSelect={vi.fn()} />
      )

      expect(screen.getAllByRole('button')).toHaveLength(5)
    })

    it('does not render any hidden buttons with aria-hidden or opacity-0', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(25)} onSelect={vi.fn()} />
      )

      const buttons = screen.getAllByRole('button')
      for (const button of buttons) {
        expect(button).not.toHaveAttribute('aria-hidden')
        expect(button).not.toHaveClass('opacity-0')
        expect(button).not.toHaveClass('pointer-events-none')
      }
    })

    it('gives all mounted buttons a non-negative tabIndex', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(25)} onSelect={vi.fn()} />
      )

      const buttons = screen.getAllByRole('button')
      for (const button of buttons) {
        expect(Number(button.getAttribute('tabindex') ?? '0')).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('cyclic ordering', () => {
    it('shows the correct cyclic window when activeIndex is 0 (default)', () => {
      const templates = makeTemplates(25)
      render(<PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={templates} onSelect={vi.fn()} />)

      const buttons = screen.getAllByRole('button')
      const labels = buttons.map((b) => b.getAttribute('aria-label'))
      // activeIndex=0, window should be: [23, 24, 0, 1, 2] (cyclic neighbors)
      expect(labels).toEqual(['Template 24', 'Template 25', 'Template 1', 'Template 2', 'Template 3'])
    })

    it('wraps forward: selecting template at index 24 shows correct window', () => {
      const templates = makeTemplates(25)
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="Prompt 25" templates={templates} onSelect={vi.fn()} />
      )

      const buttons = screen.getAllByRole('button')
      const labels = buttons.map((b) => b.getAttribute('aria-label'))
      // activeIndex=24, window: [22, 23, 24, 0, 1]
      expect(labels).toEqual(['Template 23', 'Template 24', 'Template 25', 'Template 1', 'Template 2'])
      expect(screen.getByRole('button', { name: 'Template 25' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('wraps backward: selecting template at index 1 shows correct window', () => {
      const templates = makeTemplates(25)
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="Prompt 2" templates={templates} onSelect={vi.fn()} />
      )

      const buttons = screen.getAllByRole('button')
      const labels = buttons.map((b) => b.getAttribute('aria-label'))
      // activeIndex=1, window: [24, 0, 1, 2, 3]
      expect(labels).toEqual(['Template 25', 'Template 1', 'Template 2', 'Template 3', 'Template 4'])
    })

    it('clicking a visible neighbor card selects it and re-centers the window', () => {
      const templates = makeTemplates(25)
      const onSelect = vi.fn()
      const { rerender } = render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={templates} onSelect={onSelect} />
      )

      // Click template 3 (index 2), which is visible in the initial window
      fireEvent.click(screen.getByRole('button', { name: 'Template 3' }))
      expect(onSelect).toHaveBeenCalledWith('Prompt 3')

      // Re-render with the new prompt to simulate the parent updating
      rerender(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="Prompt 3" templates={templates} onSelect={onSelect} />
      )

      const buttons = screen.getAllByRole('button')
      const labels = buttons.map((b) => b.getAttribute('aria-label'))
      // activeIndex=2, window: [0, 1, 2, 3, 4]
      expect(labels).toEqual(['Template 1', 'Template 2', 'Template 3', 'Template 4', 'Template 5'])
      expect(screen.getByRole('button', { name: 'Template 3' })).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('selection and ARIA', () => {
    it('marks only the selected card as aria-pressed', () => {
      render(
        <PaintingTemplateShowcase
          paintingId="painting-1"
          prompt="Prompt 1"
          templates={makeTemplates(25)}
          onSelect={vi.fn()}
        />
      )

      const buttons = screen.getAllByRole('button')
      const pressedButtons = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')
      expect(pressedButtons).toHaveLength(1)
      expect(pressedButtons[0]).toHaveAttribute('aria-label', 'Template 1')
    })

    it('provides the group role with an accessible label', () => {
      render(
        <PaintingTemplateShowcase paintingId="painting-1" prompt="" templates={makeTemplates(25)} onSelect={vi.fn()} />
      )

      expect(screen.getByRole('group', { name: 'paintings.showcase.styles_label' })).toBeInTheDocument()
    })

    it('places the selected card in the center carousel position', () => {
      render(
        <PaintingTemplateShowcase
          paintingId="painting-1"
          prompt="Prompt 5"
          templates={makeTemplates(25)}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'Template 5' })).toHaveStyle({
        transform: 'translate(-50%, calc(-50% - 2px)) rotate(0deg) scale(1.12)'
      })
    })
  })
})
