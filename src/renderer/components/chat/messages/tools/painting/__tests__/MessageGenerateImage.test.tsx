import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'

const { getPhysicalPath } = vi.hoisted(() => ({ getPhysicalPath: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.unmock('@cherrystudio/ui')

import { MessageGenerateImageToolTitle } from '../MessageGenerateImage'

function toolResponse(overrides: Partial<NormalToolResponse>): NormalToolResponse {
  return {
    id: 'tc1',
    tool: { name: 'generate_image' } as NormalToolResponse['tool'],
    toolCallId: 'tc1',
    arguments: { prompt: 'a cat' },
    status: 'done',
    ...overrides
  }
}

function mcpToolResponse(response: unknown): McpToolResponse {
  return {
    id: 'tc-agent',
    tool: {
      id: 'cherry-tools__generate_image',
      name: 'generate_image',
      type: 'mcp',
      serverId: 'cherry-tools',
      serverName: 'cherry-tools',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    toolCallId: 'tc-agent',
    arguments: { prompt: 'a cat' },
    status: 'done',
    response
  }
}

describe('MessageGenerateImageToolTitle', () => {
  beforeEach(() => {
    getPhysicalPath.mockReset().mockResolvedValue('/data/f1.png')
    ;(window as unknown as { api: unknown }).api = { file: { getPhysicalPath } }
  })

  it.each(['legacy', 'envelope', 'pi-content'])('renders %s generated results as local images', async (shape) => {
    const images = [{ id: 'f1', name: 'a.png' }]
    const envelope = { type: 'generated-images', images }
    const response =
      shape === 'legacy' ? images : shape === 'envelope' ? envelope : [{ type: 'text', text: JSON.stringify(envelope) }]
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response })} />)
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'file:///data/f1.png'))
  })

  it('opens any generated image and navigates the entire result group', async () => {
    const user = userEvent.setup()
    getPhysicalPath.mockImplementation(({ id }: { id: string }) => Promise.resolve(`/data/${id}.png`))
    render(
      <MessageGenerateImageToolTitle
        toolResponse={toolResponse({
          response: [
            { id: 'f1', name: 'a.png' },
            { id: 'f2', name: 'b.png' }
          ]
        })}
      />
    )
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    await user.click(screen.getAllByRole('img')[1])
    const dialog = screen.getByRole('dialog', { name: 'preview.label' })
    expect(within(dialog).getByRole('presentation', { hidden: true })).toHaveAttribute('src', 'file:///data/f2.png')
    await user.click(within(dialog).getByRole('button', { name: 'preview.previous' }))
    expect(within(dialog).getByRole('presentation', { hidden: true })).toHaveAttribute('src', 'file:///data/f1.png')
    await user.click(within(dialog).getByRole('button', { name: 'preview.next' }))
    expect(within(dialog).getByRole('presentation', { hidden: true })).toHaveAttribute('src', 'file:///data/f2.png')
  })

  it('renders agent MCP image blocks without resolving FileEntry paths', () => {
    render(
      <MessageGenerateImageToolTitle
        toolResponse={mcpToolResponse({
          content: [
            { type: 'text', text: 'Generated image' },
            { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
          ],
          metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
        })}
      />
    )

    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(getPhysicalPath).not.toHaveBeenCalled()
  })

  it('shows localized failure copy (not the English MCP text) when no image block was returned', () => {
    render(
      <MessageGenerateImageToolTitle
        toolResponse={mcpToolResponse({ content: [{ type: 'text', text: 'Image generation failed' }] })}
      />
    )

    expect(screen.getByText('chat.input.tools.generate_image.failed')).toBeInTheDocument()
    expect(screen.queryByText('Image generation failed')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows localized failure copy (not the English error note) when generation returned an error', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: { error: 'boom' } })} />)
    expect(screen.getByText('chat.input.tools.generate_image.failed')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps surviving results and restores an unavailable image on retry', async () => {
    const user = userEvent.setup()
    getPhysicalPath
      .mockReset()
      .mockImplementation(({ id }: { id: string }) =>
        id === 'f2' ? Promise.reject(new Error('gone')) : Promise.resolve(`/data/${id}.png`)
      )
    render(
      <MessageGenerateImageToolTitle
        toolResponse={toolResponse({
          response: [
            { id: 'f1', name: 'a.png' },
            { id: 'f2', name: 'b.png' }
          ]
        })}
      />
    )
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'file:///data/f1.png'))
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByText('b.png')).toBeInTheDocument()
    getPhysicalPath.mockImplementation(({ id }: { id: string }) => Promise.resolve(`/data/${id}.png`))
    await user.click(screen.getByRole('button', { name: 'common.retry' }))
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    expect(screen.queryByText('file_preview.unavailable.description')).not.toBeInTheDocument()
  })

  it('falls back to an error note (not a perpetual spinner) when path resolution fails', async () => {
    getPhysicalPath.mockReset().mockRejectedValue(new Error('file gone'))
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: [{ id: 'f1', name: 'a.png' }] })} />)
    await waitFor(() => expect(screen.getByText('file_preview.unavailable.description')).toBeInTheDocument())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders a spinner while the tool is still running', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ status: 'pending', response: undefined })} />)
    expect(screen.getByText('chat.input.tools.generate_image.generating')).toBeInTheDocument()
  })

  it('renders the denied outcome and rejection reason instead of a perpetual spinner', () => {
    render(
      <MessageGenerateImageToolTitle
        toolResponse={toolResponse({
          status: 'cancelled',
          response: undefined,
          approval: { approved: false, reason: 'Use the approved image provider instead' }
        })}
      />
    )

    expect(screen.getByText('agent.toolPermission.decisionDenied')).toBeInTheDocument()
    expect(screen.getByText('Use the approved image provider instead')).toBeInTheDocument()
    expect(screen.queryByText('chat.input.tools.generate_image.generating')).not.toBeInTheDocument()
  })
})
