import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPhysicalPath } = vi.hoisted(() => ({ getPhysicalPath: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@shared/utils/file', () => ({
  toSafeFileUrl: (path: string) => `file://${path}`
}))
vi.mock('@renderer/components/Spinner', () => ({
  default: ({ text }: { text: React.ReactNode }) => <div data-testid="spinner">{text}</div>
}))
vi.mock('../../../blocks/ImageBlock', () => ({
  default: ({ images, isPending }: { images: string[]; isPending?: boolean }) => (
    <div data-testid="image-block" data-pending={String(isPending)}>
      {images.join('|')}
    </div>
  )
}))

import { MessageGenerateImageToolTitle } from '../MessageGenerateImage'

function toolResponse(overrides: Partial<NormalToolResponse>): NormalToolResponse {
  return {
    id: 'tc1',
    tool: { name: 'generate_image' } as NormalToolResponse['tool'],
    toolCallId: 'tc1',
    arguments: { prompt: 'a cat' },
    status: 'done',
    ...overrides
  } as NormalToolResponse
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

  it('renders the generated images resolved to file URLs', async () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: [{ id: 'f1', name: 'a.png' }] })} />)
    await waitFor(() => expect(screen.getByTestId('image-block')).toHaveTextContent('file:///data/f1.png'))
    expect(getPhysicalPath).toHaveBeenCalledWith({ id: 'f1' })
  })

  it('lays multiple generated images out as a grid of separate tiles', async () => {
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
    await waitFor(() => expect(screen.getAllByTestId('image-block')).toHaveLength(2))
    const tiles = screen.getAllByTestId('image-block').map((el) => el.textContent)
    expect(tiles).toEqual(['file:///data/f1.png', 'file:///data/f2.png'])
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

    expect(screen.getByTestId('image-block')).toHaveTextContent('data:image/png;base64,iVBORw0KGgo=')
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
    expect(screen.queryByTestId('image-block')).not.toBeInTheDocument()
  })

  it('shows localized failure copy (not the English error note) when generation returned an error', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: { error: 'boom' } })} />)
    expect(screen.getByText('chat.input.tools.generate_image.failed')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    expect(screen.queryByTestId('image-block')).not.toBeInTheDocument()
  })

  it('keeps the resolvable images when only some FileEntry paths fail', async () => {
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
    // Only the resolvable tile renders; the failed one is dropped, not shown as an overall failure.
    await waitFor(() => expect(screen.getByTestId('image-block')).toHaveTextContent('file:///data/f1.png'))
    expect(screen.getAllByTestId('image-block')).toHaveLength(1)
    expect(screen.queryByText('chat.input.tools.generate_image.failed')).not.toBeInTheDocument()
  })

  it('falls back to an error note (not a perpetual spinner) when path resolution fails', async () => {
    getPhysicalPath.mockReset().mockRejectedValue(new Error('file gone'))
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: [{ id: 'f1', name: 'a.png' }] })} />)
    await waitFor(() => expect(screen.getByText('chat.input.tools.generate_image.failed')).toBeInTheDocument())
    expect(screen.queryByTestId('image-block')).not.toBeInTheDocument()
  })

  it('renders a spinner while the tool is still running', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ status: 'pending', response: undefined })} />)
    expect(screen.getByTestId('spinner')).toHaveTextContent('chat.input.tools.generate_image.generating')
  })
})
