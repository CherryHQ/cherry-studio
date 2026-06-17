// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NormalTooltip, Tooltip, TooltipContent, TooltipRoot, TooltipTrigger } from '../tooltip'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

function getTooltipContentElement(text: string) {
  const element = screen.getAllByText(text).find((node) => node.getAttribute('data-slot') === 'tooltip-content')
  expect(element).toBeInTheDocument()
  return element as HTMLElement
}

function renderOpenTooltipContent(content: ReactNode, props?: ComponentProps<typeof TooltipContent>) {
  render(
    <TooltipRoot open>
      <TooltipTrigger asChild>
        <button type="button">Trigger</button>
      </TooltipTrigger>
      <TooltipContent {...props}>{content}</TooltipContent>
    </TooltipRoot>
  )
}

describe('Tooltip', () => {
  describe('fallback rendering (no tooltip wrapper)', () => {
    it('renders a plain div when content is undefined', () => {
      const { container } = render(
        <Tooltip>
          <span>No tooltip</span>
        </Tooltip>
      )
      expect(screen.getByText('No tooltip')).toBeInTheDocument()
      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper.tagName).toBe('DIV')
      expect(wrapper.getAttribute('data-state')).toBeNull()
    })

    it('renders a plain div when content is empty string', () => {
      const { container } = render(
        <Tooltip content="">
          <span>Empty</span>
        </Tooltip>
      )
      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper.getAttribute('data-state')).toBeNull()
    })

    it('renders a plain div when isDisabled is true', () => {
      const { container } = render(
        <Tooltip content="tip" isDisabled>
          <span>Disabled</span>
        </Tooltip>
      )
      const wrapper = container.firstElementChild as HTMLElement
      expect(wrapper.tagName).toBe('DIV')
      expect(wrapper.getAttribute('data-state')).toBeNull()
    })
  })

  describe('Radix trigger rendering', () => {
    it('wraps children with Radix trigger when content is provided', () => {
      const { container } = render(
        <Tooltip content="tip">
          <button type="button">Trigger</button>
        </Tooltip>
      )
      const trigger = container.querySelector('[data-state]')
      expect(trigger).toBeInTheDocument()
      expect(screen.getByText('Trigger')).toBeInTheDocument()
    })

    it('uses title as fallback when content is not provided', () => {
      const { container } = render(
        <Tooltip title="title-tip">
          <button type="button">Trigger</button>
        </Tooltip>
      )
      const trigger = container.querySelector('[data-state]')
      expect(trigger).toBeInTheDocument()
    })

    it('treats content=undefined + title=undefined as fallback', () => {
      const { container } = render(
        <Tooltip content={undefined} title={undefined}>
          <span>Child</span>
        </Tooltip>
      )
      expect(container.querySelector('[data-state]')).toBeNull()
    })
  })

  describe('classNames', () => {
    it('applies classNames.placeholder to the trigger wrapper', () => {
      const { container } = render(
        <Tooltip content="tip" classNames={{ placeholder: 'custom-trigger' }}>
          <button type="button">Trigger</button>
        </Tooltip>
      )
      expect(container.querySelector('.custom-trigger')).toBeInTheDocument()
    })

    it('applies classNames.placeholder to fallback div when disabled', () => {
      const { container } = render(
        <Tooltip content="tip" isDisabled classNames={{ placeholder: 'custom-ph' }}>
          <span>Child</span>
        </Tooltip>
      )
      expect(container.querySelector('.custom-ph')).toBeInTheDocument()
    })

    it('applies classNames.placeholder to fallback div when no content', () => {
      const { container } = render(
        <Tooltip classNames={{ placeholder: 'ph-class' }}>
          <span>Child</span>
        </Tooltip>
      )
      expect(container.querySelector('.ph-class')).toBeInTheDocument()
    })
  })

  describe('onClick', () => {
    it('fires onClick on the trigger wrapper', () => {
      const handleClick = vi.fn()
      render(
        <Tooltip content="tip" onClick={handleClick}>
          <button type="button">Click me</button>
        </Tooltip>
      )
      fireEvent.click(screen.getByText('Click me'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('fires onClick on disabled tooltip wrapper', () => {
      const handleClick = vi.fn()
      render(
        <Tooltip content="tip" isDisabled onClick={handleClick}>
          <button type="button">Click me</button>
        </Tooltip>
      )
      fireEvent.click(screen.getByText('Click me'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('fires onClick on no-content fallback wrapper', () => {
      const handleClick = vi.fn()
      render(
        <Tooltip onClick={handleClick}>
          <button type="button">Click me</button>
        </Tooltip>
      )
      fireEvent.click(screen.getByText('Click me'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('controlled mode', () => {
    it('renders tooltip content in DOM when isOpen is true', () => {
      render(
        <Tooltip content="forced open" isOpen={true}>
          <button type="button">Trigger</button>
        </Tooltip>
      )
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('keeps the same tooltip color direction in dark mode', () => {
      render(
        <Tooltip content="dark-safe" isOpen={true}>
          <button type="button">Trigger</button>
        </Tooltip>
      )

      const content = getTooltipContentElement('dark-safe')
      expect(content).toHaveClass('bg-neutral-900', 'text-neutral-50')
      expect(content.className).not.toContain('dark:bg-neutral-100')
      expect(content.className).not.toContain('dark:text-neutral-900')
    })

    it('does not render tooltip content when isOpen is false', () => {
      render(
        <Tooltip content="forced closed" isOpen={false}>
          <button type="button">Trigger</button>
        </Tooltip>
      )
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('arrow rendering', () => {
    it('renders an arrow by default for TooltipContent', () => {
      renderOpenTooltipContent('compound tip')

      expect(getTooltipContentElement('compound tip').querySelector('svg')).toBeInTheDocument()
    })

    it('passes showArrow through NormalTooltip', () => {
      render(
        <NormalTooltip content="normal tip" open showArrow={false}>
          <button type="button">Normal trigger</button>
        </NormalTooltip>
      )

      expect(getTooltipContentElement('normal tip').querySelector('svg')).not.toBeInTheDocument()
    })

    it('omits the arrow when TooltipContent disables it', () => {
      renderOpenTooltipContent('compound tip', { showArrow: false })

      expect(getTooltipContentElement('compound tip').querySelector('svg')).not.toBeInTheDocument()
    })
  })

  describe('focus-visible filtering', () => {
    it('does not open tooltip when focused without :focus-visible', () => {
      render(
        <Tooltip content="focus tip">
          <button type="button">Trigger</button>
        </Tooltip>
      )

      const trigger = screen.getByText('Trigger')
      const matchesSpy = vi.spyOn(trigger, 'matches').mockReturnValue(false)

      try {
        fireEvent.focus(trigger)

        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      } finally {
        matchesSpy.mockRestore()
      }
    })

    it('opens tooltip when focused with :focus-visible', async () => {
      render(
        <Tooltip content="focus tip">
          <button type="button">Trigger</button>
        </Tooltip>
      )

      const trigger = screen.getByText('Trigger')
      const matchesSpy = vi.spyOn(trigger, 'matches').mockImplementation((selector) => {
        return selector === ':focus-visible'
      })

      try {
        fireEvent.focus(trigger)

        const tooltip = await screen.findByRole('tooltip')
        expect(tooltip).toBeInTheDocument()
        expect(tooltip).toHaveTextContent('focus tip')
      } finally {
        matchesSpy.mockRestore()
      }
    })

    it('calls custom onFocus handler passed to TooltipTrigger', () => {
      const handleFocus = vi.fn()
      render(
        <NormalTooltip content="tip" triggerProps={{ onFocus: handleFocus }}>
          <button type="button">Trigger</button>
        </NormalTooltip>
      )

      const trigger = screen.getByText('Trigger')
      fireEvent.focus(trigger)

      expect(handleFocus).toHaveBeenCalledTimes(1)
    })
  })
})
