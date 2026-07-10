import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolRenderItem } from '../../tools/toolResponse'
import LiveProcessToolList from '../LiveProcessToolList'
import { PartsProvider } from '../MessagePartsContext'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & { size?: string; variant?: string }) => {
    void _size
    void _variant
    return (
      <button {...props} type={props.type ?? 'button'}>
        {children}
      </button>
    )
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { size?: string }) => {
      if (key === 'common.expand') return 'Expand'
      if (key === 'common.collapse') return 'Collapse'
      if (key === 'message.tools.sections.args') return 'Arguments'
      if (key === 'message.tools.sections.output') return 'Output'
      if (key === 'message.tools.truncated') return `Truncated ${params?.size}`
      return key
    }
  })
}))

vi.mock('../../tools/ToolHeader', () => ({
  __esModule: true,
  default: ({ hasError, status, toolResponse }: any) => (
    <div
      data-testid="mock-tool-header"
      data-tool-name={toolResponse.tool.name}
      data-status={status}
      data-has-error={String(hasError)}>
      {toolResponse.tool.name}
    </div>
  )
}))

function makeItem(id: string, overrides: Partial<ToolRenderItem['toolResponse']> = {}): ToolRenderItem {
  return {
    id,
    toolResponse: {
      id,
      toolCallId: id,
      tool: { id, name: id, type: 'builtin' },
      arguments: { path: `/${id}.txt` },
      response: { result: id },
      status: 'invoking',
      ...overrides
    }
  } as ToolRenderItem
}

function renderList(
  items: ToolRenderItem[],
  options: {
    onAfterCollapse?: () => void
    onBeforeExpand?: () => void
    parts?: CherryMessagePart[]
  } = {}
) {
  const onBeforeExpand = options.onBeforeExpand ?? vi.fn()
  const onAfterCollapse = options.onAfterCollapse ?? vi.fn()
  const view = render(
    <PartsProvider value={{ message: options.parts ?? [] }}>
      <LiveProcessToolList items={items} onAfterCollapse={onAfterCollapse} onBeforeExpand={onBeforeExpand} />
    </PartsProvider>
  )

  return {
    ...view,
    onAfterCollapse,
    onBeforeExpand,
    rerenderList(nextItems: ToolRenderItem[], parts: CherryMessagePart[] = options.parts ?? []) {
      view.rerender(
        <PartsProvider value={{ message: parts }}>
          <LiveProcessToolList items={nextItems} onAfterCollapse={onAfterCollapse} onBeforeExpand={onBeforeExpand} />
        </PartsProvider>
      )
    }
  }
}

function getToolRow(toolCallId: string): HTMLElement {
  return screen.getAllByTestId('live-process-tool').find((row) => row.getAttribute('data-tool-call-id') === toolCallId)!
}

describe('LiveProcessToolList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders stable summary rows without mounting detail bodies while collapsed', () => {
    renderList([makeItem('read'), makeItem('write', { status: 'done' })])

    expect(screen.getAllByTestId('live-process-tool')).toHaveLength(2)
    expect(getToolRow('read')).toHaveAttribute('data-tool-status', 'invoking')
    expect(getToolRow('write')).toHaveAttribute('data-tool-status', 'done')
    expect(screen.queryByTestId('live-process-tool-content')).toBeNull()
  })

  it('mounts at most one detail body and calls onBeforeExpand before each opening', () => {
    const { onAfterCollapse, onBeforeExpand } = renderList([makeItem('read'), makeItem('write')])
    const readRow = getToolRow('read')
    const writeRow = getToolRow('write')

    fireEvent.click(within(readRow).getByRole('button', { name: 'Expand: read' }))

    expect(onBeforeExpand).toHaveBeenCalledTimes(1)
    expect(within(readRow).getByTestId('live-process-tool-content')).toHaveTextContent('Arguments')
    expect(within(readRow).getByTestId('live-process-tool-content')).toHaveTextContent('/read.txt')
    expect(within(writeRow).queryByTestId('live-process-tool-content')).toBeNull()

    fireEvent.click(within(writeRow).getByRole('button', { name: 'Expand: write' }))

    expect(onBeforeExpand).toHaveBeenCalledTimes(2)
    expect(within(readRow).queryByTestId('live-process-tool-content')).toBeNull()
    expect(within(writeRow).getByTestId('live-process-tool-content')).toHaveTextContent('write')
    expect(screen.getAllByTestId('live-process-tool-content')).toHaveLength(1)

    fireEvent.click(within(writeRow).getByRole('button', { name: 'Collapse: write' }))
    expect(onAfterCollapse).toHaveBeenCalledOnce()
  })

  it('preserves the expanded tool and row node across appends and status transitions', () => {
    const initialItem = makeItem('read')
    const { onBeforeExpand, rerenderList } = renderList([initialItem])
    const initialRow = getToolRow('read')

    fireEvent.click(within(initialRow).getByRole('button', { name: 'Expand: read' }))

    for (const status of ['streaming', 'done', 'error'] as const) {
      rerenderList([makeItem('read', { status }), makeItem('write')])
      const currentRow = getToolRow('read')
      expect(currentRow).toBe(initialRow)
      expect(currentRow).toHaveAttribute('data-tool-status', status)
      expect(within(currentRow).getByTestId('live-process-tool-content')).toBeInTheDocument()
      expect(within(currentRow).getByRole('button', { name: 'Collapse: read' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    }

    expect(onBeforeExpand).toHaveBeenCalledTimes(1)
  })

  it('supports a parent-controlled expanded tool id shared across tool segments', () => {
    const onBeforeExpand = vi.fn()
    const onExpandedToolIdChange = vi.fn()
    const items = [makeItem('read'), makeItem('write')]
    const { rerender } = render(
      <PartsProvider value={{ message: [] }}>
        <LiveProcessToolList
          items={items}
          onBeforeExpand={onBeforeExpand}
          expandedToolId="read"
          onExpandedToolIdChange={onExpandedToolIdChange}
        />
      </PartsProvider>
    )

    expect(within(getToolRow('read')).getByTestId('live-process-tool-content')).toBeInTheDocument()
    expect(within(getToolRow('write')).queryByTestId('live-process-tool-content')).toBeNull()

    fireEvent.click(within(getToolRow('write')).getByRole('button', { name: 'Expand: write' }))

    expect(onBeforeExpand).toHaveBeenCalledTimes(1)
    expect(onExpandedToolIdChange).toHaveBeenCalledWith('write')
    expect(onBeforeExpand.mock.invocationCallOrder[0]).toBeLessThan(onExpandedToolIdChange.mock.invocationCallOrder[0])

    rerender(
      <PartsProvider value={{ message: [] }}>
        <LiveProcessToolList
          items={items}
          onBeforeExpand={onBeforeExpand}
          expandedToolId="write"
          onExpandedToolIdChange={onExpandedToolIdChange}
        />
      </PartsProvider>
    )

    expect(within(getToolRow('read')).queryByTestId('live-process-tool-content')).toBeNull()
    expect(within(getToolRow('write')).getByTestId('live-process-tool-content')).toBeInTheDocument()

    fireEvent.click(within(getToolRow('write')).getByRole('button', { name: 'Collapse: write' }))

    expect(onExpandedToolIdChange).toHaveBeenLastCalledWith(null)
    expect(onBeforeExpand).toHaveBeenCalledTimes(1)
  })

  it('derives approval waiting and response-level errors without changing disclosure state', () => {
    const approvalPart = {
      type: 'dynamic-tool',
      toolCallId: 'approval-tool',
      toolName: 'approval-tool',
      state: 'approval-requested',
      approval: { id: 'approval-id' },
      input: {}
    } as unknown as CherryMessagePart
    const waitingItem = makeItem('approval-tool', { status: 'pending' })
    const responseErrorItem = makeItem('response-error', {
      status: 'done',
      response: { isError: true, message: 'failed' }
    })

    renderList([waitingItem, responseErrorItem], { parts: [approvalPart] })

    expect(getToolRow('approval-tool')).toHaveAttribute('data-tool-status', 'waiting')
    expect(getToolRow('response-error')).toHaveAttribute('data-tool-status', 'error')
    expect(getToolRow('response-error')).toHaveAttribute('data-tool-error', 'true')
    expect(within(getToolRow('response-error')).getByTestId('mock-tool-header')).toHaveAttribute(
      'data-has-error',
      'true'
    )
  })

  it('preserves parallel activity while a real approval is awaiting', () => {
    const approvalPart = {
      type: 'dynamic-tool',
      toolCallId: 'approval-tool',
      toolName: 'approval-tool',
      state: 'approval-requested',
      approval: { id: 'approval-id' },
      input: {}
    } as unknown as CherryMessagePart

    render(
      <PartsProvider value={{ message: [approvalPart] }}>
        <LiveProcessToolList
          items={[makeItem('unfinished', { status: 'streaming' }), makeItem('approval-tool', { status: 'pending' })]}
          onBeforeExpand={vi.fn()}
        />
      </PartsProvider>
    )

    expect(getToolRow('unfinished')).toHaveAttribute('data-tool-status', 'streaming')
    expect(getToolRow('approval-tool')).toHaveAttribute('data-tool-status', 'waiting')
  })

  it('prefers partial arguments and safely truncates circular generic detail values', () => {
    const circular: Record<string, unknown> = { value: 'result' }
    circular.self = circular
    const longPartialArguments = `{"query":"${'x'.repeat(13_000)}`
    const item = makeItem('search', {
      partialArguments: longPartialArguments,
      response: circular,
      status: 'streaming'
    })

    renderList([item])
    const row = getToolRow('search')
    fireEvent.click(within(row).getByRole('button', { name: 'Expand: search' }))

    const content = within(row).getByTestId('live-process-tool-content')
    const truncatedSection = content.querySelector('[data-truncated="true"]')
    expect(truncatedSection).not.toBeNull()
    expect(truncatedSection).toHaveTextContent('Truncated')
    expect(content).toHaveTextContent('[Circular]')
    expect(content).not.toHaveTextContent('/search.txt')
  })
})
