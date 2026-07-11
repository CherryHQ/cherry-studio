import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import LiveProcessRun from '../LiveProcessRun'

const autoScrollMockState = vi.hoisted(() => ({ hasOverflow: false }))

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

vi.mock('../useProcessRunAutoScroll', () => ({
  useProcessRunAutoScroll: () => ({
    contentRef: vi.fn(),
    hasOverflow: autoScrollMockState.hasOverflow,
    pauseForInteraction: vi.fn(),
    viewportRef: vi.fn()
  })
}))

describe('LiveProcessRun', () => {
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

    expect(screen.getByTestId('live-process-run-content')).toHaveClass('overflow-y-auto')
    if (hasOverflow) {
      expect(screen.getByTestId('live-process-run-content')).toHaveClass('overscroll-contain')
    } else {
      expect(screen.getByTestId('live-process-run-content')).not.toHaveClass('overscroll-contain')
    }
  })
})
