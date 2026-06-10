import { render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import {
  getEffectiveStatus,
  StreamingContext,
  ToolStatusIndicator,
  TruncatedIndicator,
  useIsStreaming
} from '../GenericTools'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'message.tools.invoking') return 'In progress'
      if (key === 'message.tools.pending') return 'Waiting for approval'
      if (key === 'message.tools.completed') return 'Completed'
      if (key === 'message.tools.error') return 'Error'
      if (key === 'message.tools.truncated') return `Output truncated (${options?.size})`
      return options?.defaultValue ?? key
    }
  })
}))

describe('getEffectiveStatus', () => {
  it('converts pending status into invoking unless approval is waiting', () => {
    expect(getEffectiveStatus('pending', false)).toBe('invoking')
    expect(getEffectiveStatus('pending', true)).toBe('waiting')
  })

  it('preserves concrete statuses and defaults missing values to pending', () => {
    expect(getEffectiveStatus('done', false)).toBe('done')
    expect(getEffectiveStatus(undefined, false)).toBe('pending')
  })
})

describe('ToolStatusIndicator', () => {
  it('renders localized status labels', () => {
    render(<ToolStatusIndicator status="invoking" />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('uses the error label for completed tools with error output', () => {
    render(<ToolStatusIndicator status="done" hasError />)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })
})

describe('TruncatedIndicator', () => {
  it('shows the formatted original output size', () => {
    render(<TruncatedIndicator originalLength={2048} />)
    expect(screen.getByText('Output truncated (2 KB)')).toBeInTheDocument()
  })
})

describe('StreamingContext', () => {
  it('defaults to false', () => {
    function Probe() {
      return <span>{useIsStreaming() ? 'streaming' : 'idle'}</span>
    }

    render(<Probe />)
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('reads streaming state from the provider', () => {
    function Probe() {
      return <span>{useIsStreaming() ? 'streaming' : 'idle'}</span>
    }

    render(
      <StreamingContext value={true}>
        <Probe />
      </StreamingContext>
    )
    expect(screen.getByText('streaming')).toBeInTheDocument()
  })
})
