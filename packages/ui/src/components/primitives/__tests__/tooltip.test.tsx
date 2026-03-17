// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Tooltip } from '../tooltip'

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
          <button>Trigger</button>
        </Tooltip>
      )
      const trigger = container.querySelector('[data-state]')
      expect(trigger).toBeInTheDocument()
      expect(screen.getByText('Trigger')).toBeInTheDocument()
    })

    it('uses title as fallback when content is not provided', () => {
      const { container } = render(
        <Tooltip title="title-tip">
          <button>Trigger</button>
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
          <button>Trigger</button>
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
          <button>Click me</button>
        </Tooltip>
      )
      fireEvent.click(screen.getByText('Click me'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('fires onClick on disabled tooltip wrapper', () => {
      const handleClick = vi.fn()
      render(
        <Tooltip content="tip" isDisabled onClick={handleClick}>
          <button>Click me</button>
        </Tooltip>
      )
      fireEvent.click(screen.getByText('Click me'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('fires onClick on no-content fallback wrapper', () => {
      const handleClick = vi.fn()
      render(
        <Tooltip onClick={handleClick}>
          <button>Click me</button>
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
          <button>Trigger</button>
        </Tooltip>
      )
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('does not render tooltip content when isOpen is false', () => {
      render(
        <Tooltip content="forced closed" isOpen={false}>
          <button>Trigger</button>
        </Tooltip>
      )
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})
