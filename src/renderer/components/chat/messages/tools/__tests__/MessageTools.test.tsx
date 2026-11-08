import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toolResultService } from '@renderer/services/aiTransport'
import type { McpToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { MessagePartsScopeProvider, ToolPartScopeProvider } from '../../blocks/MessagePartsContext'
import MessageTools from '../MessageTools'

const { copyText, notifyError } = vi.hoisted(() => ({ copyText: vi.fn(), notifyError: vi.fn() }))
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ copyText, notifyError }),
  useOptionalMessageListUi: () => ({}),
  useOptionalMessageListTopicId: () => 'lazy-topic',
  useMessageRenderConfig: () => ({ messageFont: 'sans-serif', fontSize: 14 })
}))
vi.mock('../hooks/useToolApproval', () => ({ useToolApproval: () => ({ isWaiting: false }) }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCodeStyle: () => ({ highlightCode: vi.fn() }) }))

const ref = { topicId: 'lazy-topic', messageId: 'lazy-message', toolCallId: 'lazy-call' }
const response: McpToolResponse = {
  id: 'lazy-call',
  toolCallId: 'lazy-call',
  tool: {
    id: 'server__execute',
    name: 'execute',
    type: 'mcp',
    serverId: 'server',
    serverName: 'Server',
    inputSchema: { type: 'object' }
  },
  arguments: { command: 'show' },
  status: 'done',
  response: { $deferredToolResult: ref }
}

const readPurpose = (input: unknown) =>
  input && typeof input === 'object' && 'purpose' in input ? input.purpose : undefined
let releaseTopic: () => void

beforeEach(async () => {
  releaseTopic = toolResultService.retainTopic(ref.topicId)
  await i18n.changeLanguage('en-US')
  vi.clearAllMocks()
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
    ok: true,
    data:
      readPurpose(input) === 'preview'
        ? { status: 'ready', purpose: 'preview', output: {}, truncated: false }
        : { status: 'ready', purpose: 'text-range', text: 'Bounded result page', nextCursor: 262144 }
  }))
})
afterEach(() => releaseTopic())

describe('latest deferred tool disclosure', () => {
  it('reads no collapsed result, loads a bounded range on expansion and releases details on close', async () => {
    const user = userEvent.setup()
    const part: CherryMessagePart = {
      type: 'dynamic-tool',
      toolName: 'execute',
      toolCallId: ref.toolCallId,
      input: response.arguments,
      state: 'output-available',
      output: response.response
    }
    const tree = (text: string) => (
      <MessagePartsScopeProvider messageId={ref.messageId} parts={[part, { type: 'text', text }]}>
        <ToolPartScopeProvider messageId={ref.messageId} part={part}>
          <MessageTools toolResponse={response} />
        </ToolPartScopeProvider>
      </MessagePartsScopeProvider>
    )
    const { rerender } = render(tree('first token'))
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
    const header = screen.getByRole('button', { name: /Server : execute/ })
    await user.click(header)
    expect(await screen.findByText('Bounded result page')).toBeVisible()
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('ai.tool.get_result', {
      ...ref,
      purpose: 'text-range',
      cursor: 0
    })
    rerender(tree('streamed sibling text'))
    expect(screen.getByText('Bounded result page')).toBeVisible()
    expect(
      vi.mocked(window.api.ipcApi.request).mock.calls.filter(([, input]) => readPurpose(input) === 'text-range')
    ).toHaveLength(1)
    expect(
      vi.mocked(window.api.ipcApi.request).mock.calls.filter(([, input]) => readPurpose(input) === 'preview')
    ).toHaveLength(1)
    await user.click(header)
    await waitFor(() => expect(screen.queryByText('Bounded result page')).not.toBeInTheDocument())
    expect(header).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps completed execution status when detail loading fails', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: false, error: { message: 'Read failed' } })
    const user = userEvent.setup()
    render(<MessageTools toolResponse={response} />)
    await user.click(screen.getByRole('button', { name: /Server : execute/ }))
    expect(await screen.findByText('No data available for this tool')).toBeVisible()
    expect(screen.getByText('All wrapped up')).toBeVisible()
  })

  it('copies the latest full result explicitly while the card is collapsed', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: { status: 'ready', purpose: 'full', output: 'Complete result beyond preview' }
    })
    const user = userEvent.setup()
    render(<MessageTools toolResponse={response} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith(
        expect.stringContaining('Complete result beyond preview'),
        expect.anything()
      )
    )
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('ai.tool.get_result', { ...ref, purpose: 'full' })
  })

  it('copies the complete meta-tool result rather than its bounded preview', async () => {
    const output = { text: 'x'.repeat(64_012) + 'COMPLETE_END' }
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
      ok: true,
      data:
        readPurpose(input) === 'full'
          ? { status: 'ready', purpose: 'full', output }
          : { status: 'ready', purpose: 'preview', output: { text: 'x'.repeat(8192) }, truncated: true }
    }))
    const user = userEvent.setup()
    render(
      <MessageTools
        toolResponse={{
          ...response,
          toolCallId: ref.toolCallId,
          tool: { id: 'tool_invoke', name: 'tool_invoke', type: 'builtin' },
          arguments: { name: 'read', params: { path: 'large.txt' } }
        }}
      />
    )
    await screen.findByRole('button', { name: /tool_invoke/ })
    expect(vi.mocked(window.api.ipcApi.request).mock.calls.some(([, input]) => readPurpose(input) === 'full')).toBe(
      false
    )
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(copyText).toHaveBeenCalled())
    expect(JSON.parse(copyText.mock.calls[0][0])).toEqual({
      args: { name: 'read', params: { path: 'large.txt' } },
      response: output
    })
  })

  it('reports a failed full meta-tool read without copying the preview', async () => {
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
      ok: true,
      data:
        readPurpose(input) === 'full'
          ? { status: 'unavailable' }
          : { status: 'ready', purpose: 'preview', output: { text: 'Only a preview' }, truncated: true }
    }))
    const user = userEvent.setup()
    render(
      <MessageTools
        toolResponse={{
          ...response,
          toolCallId: ref.toolCallId,
          tool: { id: 'tool_invoke', name: 'tool_invoke', type: 'builtin' },
          arguments: { name: 'read' }
        }}
      />
    )
    await user.click(await screen.findByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Copy failed'))
    expect(copyText).not.toHaveBeenCalled()
  })

  it('loads an owned image preview only after expanding a deferred MCP result', async () => {
    const uri = 'cherry-media://tool-result/lazy-topic/lazy-message/lazy-call/0'
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
      ok: true,
      data:
        readPurpose(input) === 'preview'
          ? {
              status: 'ready',
              purpose: 'preview',
              output: { content: [{ type: 'resource_link', uri, name: 'image', mimeType: 'image/png' }] },
              truncated: false
            }
          : { status: 'ready', purpose: 'text-range', text: 'Bounded raw image details' }
    }))
    const user = userEvent.setup()
    render(<MessageTools toolResponse={response} />)
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Server : execute/ }))
    expect(await screen.findByRole('img')).toHaveAttribute('src', uri)
    expect(await screen.findByText('Bounded raw image details')).toBeVisible()
    expect(vi.mocked(window.api.ipcApi.request).mock.calls.some(([, input]) => readPurpose(input) === 'full')).toBe(
      false
    )
  })

  it('resets a paged viewer when a latest-result invalidation arrives', async () => {
    const user = userEvent.setup()
    render(<MessageTools toolResponse={response} />)
    await user.click(screen.getByRole('button', { name: /Server : execute/ }))
    await screen.findByText('Bounded result page')
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
      ok: true,
      data: { status: 'ready', purpose: 'text-range', text: 'Second old page' }
    })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Second old page')).toBeVisible()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: { status: 'ready', purpose: 'text-range', text: 'Replacement first page' }
    })
    act(() => toolResultService.invalidate(ref))
    expect(await screen.findByText('Replacement first page')).toBeVisible()
    expect(screen.queryByText('Second old page')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
  })
})
