import type { NormalToolResponse } from '@renderer/types/mcpTool'
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
vi.mock('../../shared/ToolDisclosure', () => ({
  ToolDisclosure: ({
    items
  }: {
    items: Array<{ key: string; label: React.ReactNode; children?: React.ReactNode }>
  }) => (
    <div data-testid="disclosure">
      {items.map((item) => (
        <div key={item.key}>
          {item.label}
          {item.children}
        </div>
      ))}
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

  it('renders the error note when generation returned an error', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ response: { error: 'boom' } })} />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByTestId('image-block')).not.toBeInTheDocument()
  })

  it('renders a spinner while the tool is still running', () => {
    render(<MessageGenerateImageToolTitle toolResponse={toolResponse({ status: 'pending', response: undefined })} />)
    expect(screen.getByTestId('spinner')).toHaveTextContent('chat.input.tools.generate_image.generating')
  })
})
