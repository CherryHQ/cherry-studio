// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  NormalTooltip,
  Tooltip,
  TOOLTIP_EXIT_ANIMATION_MS,
  TooltipContent,
  TooltipRoot,
  TooltipTrigger
} from '../tooltip'

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
  })

  describe('classNames', () => {
    it('renders a full-width trigger wrapper when fullWidthTrigger is enabled', () => {
      const { container } = render(
        <Tooltip content="tip" fullWidthTrigger>
          <span>Trigger</span>
        </Tooltip>
      )

      const wrapper = container.querySelector('[data-state]') as HTMLElement
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveClass('block', 'w-full', 'min-w-0', 'max-w-full')
      expect(wrapper).not.toHaveClass('inline-block')
    })

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

    it('inverts tooltip colors in dark mode', () => {
      render(
        <Tooltip content="dark-safe" isOpen={true}>
          <button type="button">Trigger</button>
        </Tooltip>
      )

      const content = getTooltipContentElement('dark-safe')
      expect(content).toHaveClass('bg-neutral-900', 'text-neutral-50', 'dark:bg-neutral-100', 'dark:text-neutral-900')
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
    it('renders a positioned Radix arrow by default for TooltipContent', () => {
      renderOpenTooltipContent('compound tip')

      const content = getTooltipContentElement('compound tip')
      const arrow = content.querySelector('svg')
      expect(arrow).toBeInTheDocument()
      expect(arrow).toHaveClass(
        'fill-neutral-900',
        'stroke-neutral-900',
        'stroke-2',
        'dark:fill-neutral-100',
        'dark:stroke-neutral-100'
      )
      expect(arrow).toHaveAttribute('width', '12')
      expect(arrow).toHaveAttribute('height', '6')
      expect(arrow).toHaveClass('-translate-y-px')
    })

    it('passes showArrow through NormalTooltip', () => {
      render(
        <NormalTooltip content="normal tip" open showArrow={false}>
          <button type="button">Normal trigger</button>
        </NormalTooltip>
      )

      const content = getTooltipContentElement('normal tip')
      expect(content.querySelector('svg')).not.toBeInTheDocument()
    })

    it('omits the arrow when TooltipContent disables it', () => {
      renderOpenTooltipContent('compound tip', { showArrow: false })

      const content = getTooltipContentElement('compound tip')
      expect(content.querySelector('svg')).not.toBeInTheDocument()
    })
  })

  describe('Electron drag-region opt-out', () => {
    it('marks tooltip content as no-drag so it stays interactive over titlebar drag regions', () => {
      renderOpenTooltipContent('drag-safe tip')

      expect(getTooltipContentElement('drag-safe tip')).toHaveClass('[-webkit-app-region:no-drag]')
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

  // 卸载不依赖 Radix Presence 的 animationend（布局重排会吞掉该事件导致 content 永久残留），
  // 而是 150ms 退出窗口后的确定性 timer——这两条把该契约钉死。
  describe('close-after mount window', () => {
    it('keeps content mounted through the exit animation, then unmounts', () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <Tooltip content="exit-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        expect(screen.getByRole('tooltip')).toBeInTheDocument()

        view.rerender(
          <Tooltip content="exit-tip" isOpen={false}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        // 退出动画窗口内仍在（淡出可见），而不是瞬时消失
        expect(screen.getByRole('tooltip')).toBeInTheDocument()

        act(() => {
          vi.advanceTimersByTime(TOOLTIP_EXIT_ANIMATION_MS + 10)
        })
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not unmount when reopened inside the exit window', () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <Tooltip content="rapid-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        view.rerender(
          <Tooltip content="rapid-tip" isOpen={false}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        act(() => {
          vi.advanceTimersByTime(100)
        })

        view.rerender(
          <Tooltip content="rapid-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        act(() => {
          vi.advanceTimersByTime(TOOLTIP_EXIT_ANIMATION_MS + 10)
        })
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // 受控状态必须权威：isOpen/open 由调用方决定，hover/pointer 交互只报告不给内部状态
  describe('controlled authority', () => {
    it('never opens when controlled isOpen is false, but still reports hover', () => {
      vi.useFakeTimers()
      try {
        const handleOpenChange = vi.fn()
        render(
          <Tooltip content="ctl" isOpen={false} onOpenChange={handleOpenChange} delay={1}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        const trigger = screen.getByText('Trigger')
        fireEvent.pointerMove(trigger)
        act(() => {
          vi.advanceTimersByTime(50)
        })
        expect(handleOpenChange).toHaveBeenCalledWith(true)
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('stays open when controlled isOpen is true despite pointer down', () => {
      vi.useFakeTimers()
      try {
        const handleOpenChange = vi.fn()
        render(
          <Tooltip content="ctl" isOpen={true} onOpenChange={handleOpenChange}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        fireEvent.pointerDown(screen.getByText('Trigger'))
        act(() => {
          vi.advanceTimersByTime(TOOLTIP_EXIT_ANIMATION_MS + TOOLTIP_EXIT_ANIMATION_MS + 100)
        })
        expect(handleOpenChange).toHaveBeenCalledWith(false)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps TooltipRoot controlled open authoritative too', () => {
      vi.useFakeTimers()
      try {
        const handleOpenChange = vi.fn()
        render(
          <TooltipRoot open={false} onOpenChange={handleOpenChange}>
            <TooltipTrigger asChild>
              <button type="button">Root trigger</button>
            </TooltipTrigger>
            <TooltipContent>root tip</TooltipContent>
          </TooltipRoot>
        )
        fireEvent.pointerMove(screen.getByText('Root trigger'))
        act(() => {
          vi.advanceTimersByTime(50)
        })
        expect(handleOpenChange).toHaveBeenCalledWith(true)
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps orphaned closed content after the sweep delay', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        // jsdom 的 MutationObserver 走原生微任务，排空后清扫 timer 才会被登记
        await act(async () => {})

        // 退出窗口内（<清扫延迟）不删
        act(() => {
          vi.advanceTimersByTime(160)
        })
        expect(document.body.contains(ghost)).toBe(true)
        // 超过清扫延迟后移除
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps a ghost even after its owner instance unmounted', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {})

        const view = render(
          <Tooltip content="owner" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        view.unmount()
        act(() => {
          vi.advanceTimersByTime(300)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep content that is reopened inside its exit window', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(100)
        })
        // 退出窗口内重新打开 → 取消清扫
        ghost.setAttribute('data-state', 'open')
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(300)
        })
        expect(document.body.contains(ghost)).toBe(true)
        ghost.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('restarts the sweep window when content closes again after a reopen', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {}) // close @t=0，sweep timer 排期 @t=200
        act(() => {
          vi.advanceTimersByTime(50)
        })
        ghost.setAttribute('data-state', 'open') // reopen @t=50，旧 timer 应被取消
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(100)
        })
        ghost.setAttribute('data-state', 'closed') // 再 close @t=150，sweep 重新排期 @t=350
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(150)
        })
        // 第二轮退出窗口（150..300）内不得被旧 timer 提前删除
        expect(document.body.contains(ghost)).toBe(true)
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps a ghost rendered into an attached shadow root', async () => {
      vi.useFakeTimers()
      try {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        document.body.appendChild(host) // 宿主插入时已挂 shadow root → 观察并扫描
        await act(async () => {})

        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        shadow.appendChild(ghost)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(300)
        })
        expect(shadow.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps a ghost already inside the shadow when the host enters the tree', async () => {
      vi.useFakeTimers()
      try {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        shadow.appendChild(ghost)
        document.body.appendChild(host) // 插入时扫描 shadow 内既有 content
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(300)
        })
        expect(shadow.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps ghosts rendered into a custom portal container', async () => {
      vi.useFakeTimers()
      try {
        const elsewhere = document.createElement('div')
        document.body.appendChild(elsewhere)
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-state', 'closed')
        elsewhere.appendChild(ghost)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(300)
        })
        expect(elsewhere.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
