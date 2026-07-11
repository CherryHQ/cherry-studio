import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import LiveProcessRun from '../LiveProcessRun'

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
    pauseForInteraction: vi.fn(),
    viewportRef: vi.fn()
  })
}))

describe('LiveProcessRun', () => {
  it('allows wheel input at the process viewport boundary to chain to the message list', () => {
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
    expect(screen.getByTestId('live-process-run-content')).not.toHaveClass('overscroll-contain')
  })
})
