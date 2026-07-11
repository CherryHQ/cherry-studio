import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LiveProcessRun from '../LiveProcessRun'
import type * as ScrollOwnershipContextModule from '../ScrollOwnershipContext'

const autoScrollMockState = vi.hoisted(() => ({ hasOverflow: false }))
const viewportConstraintMockState = vi.hoisted(() => ({ maxHeight: null as number | null }))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
    void _size
    void _variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  }
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../ThinkingEffect', () => ({
  default: () => <span>thinking</span>
}))

vi.mock('../ToolBlockGroup', () => ({
  ToolBlockGroupHeaderContent: () => null
}))

vi.mock('../ScrollOwnershipContext', async (importOriginal) => {
  const actual = await importOriginal<typeof ScrollOwnershipContextModule>()
  return {
    ...actual,
    useScrollViewportMaxHeight: () => viewportConstraintMockState.maxHeight
  }
})

vi.mock('../useProcessRunAutoScroll', () => ({
  useProcessRunAutoScroll: () => ({
    contentRef: vi.fn(),
    hasOverflow: autoScrollMockState.hasOverflow,
    pauseForInteraction: vi.fn(),
    viewportRef: vi.fn()
  })
}))

describe('LiveProcessRun', () => {
  beforeEach(() => {
    autoScrollMockState.hasOverflow = false
    viewportConstraintMockState.maxHeight = null
  })

  it.each([
    ['contains boundary wheel input while the viewport has overflow', true],
    ['allows wheel input to reach the message list when the viewport has no overflow', false]
  ])('%s', (_label, hasOverflow) => {
    autoScrollMockState.hasOverflow = hasOverflow
    render(
      <LiveProcessRun
        id="run-1"
        allToolsTerminal={false}
        hasReasoning
        headerToolItems={[]}
        hasToolError={false}
        isExpanded
        isLive
        isReasoningTail
        onExpandedChange={vi.fn()}
        renderContent={() => <div>details</div>}
        toolCount={0}
      />
    )

    expect(screen.getByTestId('live-process-run-content')).toHaveClass(
      'max-h-[min(50vh,calc(100vh-12rem))]',
      'overflow-y-auto'
    )
    if (hasOverflow) {
      expect(screen.getByTestId('live-process-run-content')).toHaveClass('overscroll-contain')
    } else {
      expect(screen.getByTestId('live-process-run-content')).not.toHaveClass('overscroll-contain')
    }
  })

  it('reserves the managed viewport height for an expanded live process', () => {
    viewportConstraintMockState.maxHeight = 320
    render(
      <LiveProcessRun
        id="run-1"
        allToolsTerminal={false}
        hasReasoning
        headerToolItems={[]}
        hasToolError={false}
        isExpanded
        isLive
        isReasoningTail
        onExpandedChange={vi.fn()}
        renderContent={() => <div>details</div>}
        toolCount={0}
      />
    )

    expect(screen.getByTestId('live-process-run-content')).toHaveStyle({ height: '320px', maxHeight: '320px' })
  })

  it('keeps a sealed process naturally sized within the managed maximum', () => {
    viewportConstraintMockState.maxHeight = 320
    render(
      <LiveProcessRun
        id="run-1"
        allToolsTerminal
        hasReasoning
        headerToolItems={[]}
        hasToolError={false}
        isExpanded
        isLive={false}
        isReasoningTail={false}
        onExpandedChange={vi.fn()}
        renderContent={() => <div>details</div>}
        toolCount={0}
      />
    )

    const content = screen.getByTestId('live-process-run-content')
    expect(content).toHaveStyle({ maxHeight: '320px' })
    expect(content.style.height).toBe('')
  })
})
