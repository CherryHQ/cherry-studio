// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { Root as RadixTooltipRoot } from '@radix-ui/react-tooltip'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NormalTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from '../tooltip'

// 时序契约（独立字面量，刻意不复用生产常量）：缩短契约必须改这里并让测试显式失败
const EXIT_WINDOW_MS = 150
const SWEEP_DELAY_MS = 200
const OPEN_RECHECK_MS = 3000

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

    it('unmounts an open tooltip content immediately when isDisabled turns true', () => {
      const { rerender } = render(
        <Tooltip content="close-tip" isOpen>
          <button type="button">Trigger</button>
        </Tooltip>
      )
      expect(getTooltipContentElement('close-tip')).toBeInTheDocument()

      rerender(
        <Tooltip content="close-tip" isOpen isDisabled>
          <button type="button">Trigger</button>
        </Tooltip>
      )

      // Anchors hidden via display:none leave Radix tooltips parked at the viewport
      // origin during their exit animation; disabling must drop the content at once.
      expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument()
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
          vi.advanceTimersByTime(EXIT_WINDOW_MS + 10)
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
          vi.advanceTimersByTime(EXIT_WINDOW_MS + 10)
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
          vi.advanceTimersByTime(EXIT_WINDOW_MS + EXIT_WINDOW_MS + 100)
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
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        // jsdom 的 MutationObserver 走原生微任务，排空后清扫 timer 才会被登记
        await act(async () => {})

        // 退出窗口内（<清扫延迟）不删
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS - 40)
        })
        expect(document.body.contains(ghost)).toBe(true)
        // 超过清扫延迟后移除
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS / 2)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    // 真实卸载遗留链：content 节点被外部移动后再卸载（React 对已被移走的 portal 子节点静默
    // 跳过移除，jsdom/React 19 实测不抛错），留下无 owner 的 open 残骸 → 重检周期后清扫。
    // 这取代手工造节点——后者与卸载的 Tooltip 无关，证明不了真实 portal remnant 被清理。
    it('sweeps a real ghost left by unmounting a tooltip whose content moved away', async () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <Tooltip content="ghost-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        const content = screen.getByRole('tooltip').closest('[data-slot="tooltip-content"]') as HTMLElement
        const elsewhere = document.createElement('div')
        document.body.appendChild(elsewhere)
        elsewhere.appendChild(content) // 模拟 virtua 移动 DOM：content 脱离 React 管理的 portal 子树
        await act(async () => {}) // 排空 MutationObserver 微任务，登记清扫 timer
        view.unmount()
        // 残骸真实存在于移动目标容器中（React 静默跳过移除）
        expect(elsewhere.contains(content)).toBe(true)

        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS + 100)
        })
        // open 态残骸无 trigger 引用 → 清扫
        expect(elsewhere.contains(content)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps orphaned open content that lost its trigger reference', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'instant-open')
        const span = document.createElement('span')
        span.id = 'orphan-content-1'
        span.setAttribute('role', 'tooltip')
        ghost.appendChild(span)
        document.body.appendChild(ghost)
        await act(async () => {})

        // 重检周期内不清扫
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS - 100)
        })
        expect(document.body.contains(ghost)).toBe(true)
        // 周期到仍无任何 trigger 引用 → 移除
        act(() => {
          vi.advanceTimersByTime(200)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep open content still referenced by its trigger', async () => {
      vi.useFakeTimers()
      try {
        render(
          <Tooltip content="live-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        // Radix open 契约：trigger 的 aria-describedby 指向 content 内 role=tooltip span 的 id
        const trigger = document.querySelector('[data-slot="tooltip-trigger"]')
        const content = document.querySelector('[data-slot="tooltip-content"]') as HTMLElement
        expect(trigger?.getAttribute('aria-describedby')).toBeTruthy()
        // 不排空 MutationObserver 微任务则清扫 timer 未登记，断言恒真
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        // 引用仍在 → 续期重检而非清扫
        expect(content.isConnected).toBe(true)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        expect(trigger?.getAttribute('aria-describedby')).toBeTruthy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep live open content whose trigger carries its own aria-describedby', async () => {
      vi.useFakeTimers()
      try {
        render(
          <Tooltip content="own-desc-tip" isOpen={true} asChild>
            <button type="button" aria-describedby="own-hint">
              Trigger
            </button>
          </Tooltip>
        )
        // Slot 以 child props 优先：trigger 自带的 aria-describedby 会覆盖 Radix 的 contentId 引用，
        // 因此判活不能只看该引用（否则活实例会被误判为残骸）
        expect(document.querySelector('[data-slot="tooltip-trigger"]')?.getAttribute('aria-describedby')).toBe(
          'own-hint'
        )
        const content = document.querySelector('[data-slot="tooltip-content"]') as HTMLElement
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        expect(content.isConnected).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep live open content whose trigger lives in a shadow root', async () => {
      vi.useFakeTimers()
      try {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        const content = document.createElement('div')
        content.setAttribute('data-slot', 'tooltip-content')
        content.setAttribute('data-tooltip-sweepable', '')
        content.setAttribute('data-state', 'instant-open')
        const tooltipSpan = document.createElement('span')
        tooltipSpan.setAttribute('role', 'tooltip')
        tooltipSpan.setAttribute('id', 'radix-shadow-live')
        content.appendChild(tooltipSpan)
        const trigger = document.createElement('button')
        trigger.setAttribute('aria-describedby', 'radix-shadow-live')
        shadow.appendChild(trigger)
        shadow.appendChild(content)
        document.body.appendChild(host) // shadow 内预填；引用搜索必须跨 shadow boundary
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        expect(shadow.contains(content)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep live open content whose trigger lives in a nested shadow root', async () => {
      vi.useFakeTimers()
      try {
        const hostA = document.createElement('div')
        const shadowA = hostA.attachShadow({ mode: 'open' })
        const hostB = document.createElement('div')
        const shadowB = hostB.attachShadow({ mode: 'open' })
        const content = document.createElement('div')
        content.setAttribute('data-slot', 'tooltip-content')
        content.setAttribute('data-tooltip-sweepable', '')
        content.setAttribute('data-state', 'delayed-open')
        const tooltipSpan = document.createElement('span')
        tooltipSpan.setAttribute('role', 'tooltip')
        tooltipSpan.setAttribute('id', 'radix-nested-live')
        content.appendChild(tooltipSpan)
        const trigger = document.createElement('button')
        trigger.setAttribute('aria-describedby', 'radix-nested-live')
        shadowB.appendChild(trigger)
        shadowB.appendChild(content)
        shadowA.appendChild(hostB)
        const wrapper = document.createElement('div')
        wrapper.appendChild(hostA)
        document.body.appendChild(wrapper)
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        expect(shadowB.contains(content)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep when the marker is removed while a close sweep is queued', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {}) // close sweep 已排队

        ghost.removeAttribute('data-tooltip-sweepable') // 内容回到调用方持有（如 forceMount 打开）
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(500)
        })
        expect(document.body.contains(ghost)).toBe(true)
        ghost.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep when the marker is removed while a stale-open check is queued', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'instant-open') // 无 trigger 引用，本会被 stale-open 清扫
        document.body.appendChild(ghost)
        await act(async () => {})

        ghost.removeAttribute('data-tooltip-sweepable')
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS + 200)
        })
        expect(document.body.contains(ghost)).toBe(true)
        ghost.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps forceMount content alive when enabled during its own close sweep', async () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <TooltipRoot open={true}>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent>fm-race</TooltipContent>
          </TooltipRoot>
        )
        const content = getTooltipContentElement('fm-race')
        expect(content).toHaveAttribute('data-tooltip-sweepable')

        view.rerender(
          <TooltipRoot open={false}>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent>fm-race</TooltipContent>
          </TooltipRoot>
        )
        await act(async () => {}) // close 提交后清扫 timer 登记

        view.rerender(
          <TooltipRoot open={false}>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent forceMount>fm-race</TooltipContent>
          </TooltipRoot>
        )
        act(() => {
          vi.advanceTimersByTime(500)
        })
        expect(document.querySelector('[data-slot="tooltip-content"]')).toBe(content)
        content.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep live content containing an unrelated role=tooltip descendant', async () => {
      vi.useFakeTimers()
      try {
        render(
          <TooltipRoot open>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent>
              <span role="tooltip" id="unrelated-descendant">
                unrelated
              </span>
            </TooltipContent>
          </TooltipRoot>
        )
        await act(async () => {}) // 排空 mutation 微任务，确保 stale-open 重检已登记
        // 活内容的 Radix span 仍被 trigger 引用；无关的 role=tooltip 不得触发清扫
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('mounts standalone forceMount content while closed (portal layer too)', () => {
      vi.useFakeTimers()
      try {
        // 无 overlay context 的独立组合路径：Portal 层同样需要 forceMount，否则 closed 时整棵子树被卸载
        render(
          <TooltipProvider>
            <RadixTooltipRoot open={false}>
              <TooltipTrigger asChild>
                <button type="button">Trigger</button>
              </TooltipTrigger>
              <TooltipContent forceMount>standalone-fm</TooltipContent>
            </RadixTooltipRoot>
          </TooltipProvider>
        )
        const content = document.querySelector('[data-slot="tooltip-content"]')
        expect(content).toBeInTheDocument()
        expect(content).toHaveAttribute('data-state', 'closed')
        expect(content).not.toHaveAttribute('data-tooltip-sweepable')
        act(() => {
          vi.advanceTimersByTime(500)
        })
        expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument()
        content?.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps live content alive when several shadow roots each hold a reference', async () => {
      vi.useFakeTimers()
      try {
        const roots: ShadowRoot[] = []
        for (const id of ['multi-shadow-a', 'multi-shadow-b']) {
          const host = document.createElement('div')
          const shadow = host.attachShadow({ mode: 'open' })
          const trigger = document.createElement('button')
          trigger.setAttribute('aria-describedby', id)
          shadow.appendChild(trigger)
          const content = document.createElement('div')
          content.setAttribute('data-slot', 'tooltip-content')
          content.setAttribute('data-tooltip-sweepable', '')
          content.setAttribute('data-state', 'instant-open')
          const span = document.createElement('span')
          span.setAttribute('role', 'tooltip')
          span.setAttribute('id', id)
          content.appendChild(span)
          shadow.appendChild(content)
          document.body.appendChild(host)
          roots.push(shadow)
        }
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS * 2 + 100)
        })
        for (const shadow of roots) {
          expect(shadow.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument()
        }
        for (const shadow of roots) {
          shadow.querySelector('[data-slot="tooltip-content"]')?.remove()
        }
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps open remnants whose role=tooltip ids are all unreferenced', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'instant-open')
        for (const id of ['ghost-one', 'ghost-two']) {
          const span = document.createElement('span')
          span.setAttribute('role', 'tooltip')
          span.setAttribute('id', id)
          ghost.appendChild(span)
        }
        document.body.appendChild(ghost)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS + 200)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('renders forceMount content through the TooltipRoot gate even when closed', () => {
      vi.useFakeTimers()
      try {
        render(
          <TooltipRoot open={false}>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent forceMount>fm-tip</TooltipContent>
          </TooltipRoot>
        )
        const content = getTooltipContentElement('fm-tip')
        expect(content).toHaveAttribute('data-state', 'closed')
        // 显式 forceMount 内容由用户持有生命周期：不带清扫标记，永不被清扫器触碰
        expect(content).not.toHaveAttribute('data-tooltip-sweepable')
        act(() => {
          vi.advanceTimersByTime(500)
        })
        expect(getTooltipContentElement('fm-tip')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep content that is reopened inside its exit window', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {})

        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS / 2)
        })
        // 退出窗口内重新打开 → 取消清扫
        ghost.setAttribute('data-state', 'open')
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
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
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        document.body.appendChild(ghost)
        await act(async () => {}) // close @t=0，sweep timer 排期 @t=200
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS / 4)
        })
        ghost.setAttribute('data-state', 'open') // reopen @t=50，旧 timer 应被取消
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS / 2)
        })
        ghost.setAttribute('data-state', 'closed') // 再 close @t=150，sweep 重新排期 @t=350
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS - 50)
        })
        // 第二轮退出窗口（150..300）内不得被旧 timer 提前删除
        expect(document.body.contains(ghost)).toBe(true)
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS)
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
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        shadow.appendChild(ghost)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
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
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        shadow.appendChild(ghost)
        document.body.appendChild(host) // 插入时扫描 shadow 内既有 content
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(shadow.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps a ghost inside a shadow host nested in an inserted wrapper', async () => {
      vi.useFakeTimers()
      try {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        shadow.appendChild(ghost)
        const wrapper = document.createElement('div')
        wrapper.appendChild(host)
        document.body.appendChild(wrapper) // host 不是 added node，作为嵌套宿主必须被找到
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(shadow.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps a ghost inside a shadow host nested in another shadow host', async () => {
      vi.useFakeTimers()
      try {
        const hostA = document.createElement('div')
        const shadowA = hostA.attachShadow({ mode: 'open' })
        const hostB = document.createElement('div')
        const shadowB = hostB.attachShadow({ mode: 'open' })
        const ghostB = document.createElement('div')
        ghostB.setAttribute('data-slot', 'tooltip-content')
        ghostB.setAttribute('data-tooltip-sweepable', '')
        ghostB.setAttribute('data-state', 'closed')
        shadowB.appendChild(ghostB)
        shadowA.appendChild(hostB)
        const wrapper = document.createElement('div')
        wrapper.appendChild(hostA)
        document.body.appendChild(wrapper) // 插入时 hostB(shadowB) 已随 shadowA 预填 closed ghost
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(shadowB.contains(ghostB)).toBe(false)
        // shadowA 也被观察：插入后追加的 ghost 走同一 observer 的 childList 扫描
        const ghostA = document.createElement('div')
        ghostA.setAttribute('data-slot', 'tooltip-content')
        ghostA.setAttribute('data-tooltip-sweepable', '')
        ghostA.setAttribute('data-state', 'closed')
        shadowA.appendChild(ghostA)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(shadowA.contains(ghostA)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sweeps children of a DocumentFragment appended in one mutation', async () => {
      vi.useFakeTimers()
      try {
        const ghost = document.createElement('div')
        ghost.setAttribute('data-slot', 'tooltip-content')
        ghost.setAttribute('data-tooltip-sweepable', '')
        ghost.setAttribute('data-state', 'closed')
        const fragment = document.createDocumentFragment()
        fragment.appendChild(ghost)
        document.body.appendChild(fragment)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(document.body.contains(ghost)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not sweep closed content without the ownership marker', async () => {
      vi.useFakeTimers()
      try {
        // 独立 TooltipContent/显式 forceMount 内容不带清扫标记，永不被清扫器触碰
        const untouched = document.createElement('div')
        untouched.setAttribute('data-slot', 'tooltip-content')
        untouched.setAttribute('data-state', 'closed')
        document.body.appendChild(untouched)
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(400)
        })
        expect(document.body.contains(untouched)).toBe(true)
        untouched.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not reopen from retained internal state after disable/enable', () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <Tooltip content="toggle tip" delay={1}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        const trigger = screen.getByText('Trigger')
        fireEvent.pointerMove(trigger)
        act(() => {
          vi.advanceTimersByTime(50)
        })
        expect(screen.getByRole('tooltip')).toBeInTheDocument()

        view.rerender(
          <Tooltip content="toggle tip" delay={1} isDisabled>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

        view.rerender(
          <Tooltip content="toggle tip" delay={1}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        act(() => {
          vi.advanceTimersByTime(SWEEP_DELAY_MS + 100)
        })
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

        // 恢复后 trigger DOM 是重建的，需重新获取
        fireEvent.pointerMove(screen.getByText('Trigger'))
        act(() => {
          vi.advanceTimersByTime(50)
        })
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps a live tooltip in a custom portal container and sweeps its remnant', async () => {
      vi.useFakeTimers()
      try {
        const elsewhere = document.createElement('div')
        const nested = document.createElement('div')
        elsewhere.appendChild(nested)
        document.body.appendChild(elsewhere)
        const view = render(
          <Tooltip content="portal-tip" isOpen={true} portalContainer={elsewhere}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        // 公共 portalContainer 路径：内容确实渲染到自定义容器，且跨重检周期不被误扫
        const content = elsewhere.querySelector('[data-slot="tooltip-content"]') as HTMLElement
        expect(content).toBeInTheDocument()
        expect(content.closest('[data-radix-popper-content-wrapper]')).toBeInTheDocument()
        await act(async () => {})
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS + 100)
        })
        expect(content.isConnected).toBe(true)

        // 内容移出 React 管理的 portal 父级后再卸载 → React 静默跳过移除，留下真实残骸
        nested.appendChild(content)
        view.unmount()
        expect(nested.contains(content)).toBe(true)
        act(() => {
          vi.advanceTimersByTime(OPEN_RECHECK_MS + 100)
        })
        expect(nested.contains(content)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not resurrect open state when switching from controlled back to uncontrolled', () => {
      vi.useFakeTimers()
      try {
        const view = render(
          <Tooltip content="ctrl-tip" isOpen={true}>
            <button type="button">Trigger</button>
          </Tooltip>
        )
        expect(screen.getByRole('tooltip')).toBeInTheDocument()

        view.rerender(
          <Tooltip content="ctrl-tip">
            <button type="button">Trigger</button>
          </Tooltip>
        )
        act(() => {
          vi.advanceTimersByTime(EXIT_WINDOW_MS + 10)
        })
        // 交接后不得复用受控期间未更新的内部 open（需要新的 hover 交互才可再次打开）
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
