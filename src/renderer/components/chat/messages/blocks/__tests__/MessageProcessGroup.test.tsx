import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageProcessGroup from '../MessageProcessGroup'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'message.processing') return 'Processing...'
      if (key === 'message.tools.placeholder.elapsed.seconds') return `${options?.seconds ?? '0'} seconds`
      return key
    }
  })
}))

vi.mock('../ToolBlockGroup', () => ({
  ToolBlockGroupHeaderContent: ({ elapsedText, summary }: { elapsedText?: string; summary?: string }) => (
    <div data-testid="process-header">
      {summary} {elapsedText}
    </div>
  )
}))

describe('MessageProcessGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates only the active header while elapsed time advances', () => {
    const renderHistory = vi.fn(() => <div>Process history</div>)
    const message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'pending'
    } as MessageListItem

    render(
      <MessageProcessGroup phase="active" message={message} toolItems={[]}>
        {renderHistory}
      </MessageProcessGroup>
    )

    expect(renderHistory).toHaveBeenCalledOnce()
    expect(screen.getByTestId('process-header')).toHaveTextContent('0 seconds')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByTestId('process-header')).toHaveTextContent('3 seconds')
    expect(renderHistory).toHaveBeenCalledOnce()
  })
})
