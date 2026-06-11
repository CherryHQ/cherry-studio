import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TracePage } from '../TracePage'

const mocks = vi.hoisted(() => ({
  getTraceData: vi.fn()
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="code-viewer">{value}</pre>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  // SpanDetail -> ModelAvatar -> @renderer/utils -> i18n/index runs `i18n.use(initReactI18next)` at load.
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

describe('TracePage', () => {
  beforeEach(() => {
    mocks.getTraceData.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        trace: {
          getData: mocks.getTraceData
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps the trace list vertically scrollable without forcing horizontal table width', async () => {
    const longSpanName =
      'agent_session_runtime_with_a_very_long_tool_span_name_that_should_wrap_inside_the_trace_table_cell'
    mocks.getTraceData.mockResolvedValue([
      {
        id: 'span-1',
        traceId: 'trace-a',
        parentId: null,
        name: longSpanName,
        status: 'OK',
        kind: 'LLM',
        topicId: 'topic-a',
        modelName: 'model-a',
        startTime: 1000,
        endTime: 2000,
        attributes: {},
        events: [],
        links: [],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 456
        }
      }
    ])

    render(
      <div style={{ height: 240, width: 360 }}>
        <TracePage topicId="topic-a" traceId="trace-a" />
      </div>
    )

    const spanName = await screen.findByText(longSpanName)

    expect(screen.getByTestId('trace-list-scroll')).toHaveClass('overflow-y-auto', 'overflow-x-hidden', 'min-w-0')
    expect(screen.getByTestId('trace-table')).toHaveClass('min-w-0', 'overflow-hidden')
    expect(screen.getByTestId('trace-table')).not.toHaveClass('min-w-[640px]')
    expect(spanName).toHaveClass('min-w-0', 'flex-1')
  })
})
