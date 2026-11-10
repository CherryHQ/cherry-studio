import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count: number }) =>
      key === 'message.tools.linksOmitted' ? `Omitted: ${options?.count}` : key
  })
}))
vi.mock('../../shared/GenericTools', () => ({
  ToolHeader: ({ toolName }: { toolName: string }) => <div data-testid="tool-header">{toolName}</div>
}))

import { UnknownToolRenderer } from '../UnknownToolRenderer'

// UnknownToolRenderer is a render function that uses hooks — invoke it inside a component's render.
const Harness = (props: { toolName: string; input?: unknown; output?: unknown }) => (
  <>{UnknownToolRenderer(props).children}</>
)

describe('UnknownToolRenderer', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected renderer fetch'))
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
      ok: true,
      data: (input as { imageHint: boolean }).imageHint ? 'data:image/png;base64,aW1hZ2U=' : null
    }))
  })
  afterEach(() => vi.restoreAllMocks())
  it('renders inline MCP image content blocks as data URLs alongside the text', () => {
    render(
      <Harness
        toolName="mcp__cherry-tools__generate_image"
        output={{
          content: [
            { type: 'text', text: 'Generated 1 image(s)' },
            { type: 'image', data: 'BASE64', mimeType: 'image/png' }
          ]
        }}
      />
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,BASE64')
    expect(screen.getByText('Generated 1 image(s)')).toBeInTheDocument()
  })

  it('shows text only when the MCP result carries no image content', () => {
    render(
      <Harness
        toolName="mcp__cherry-tools__generate_image"
        output={{ content: [{ type: 'text', text: 'No painting model is configured.' }] }}
      />
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No painting model is configured.')).toBeInTheDocument()
  })

  it('previews image URLs from MCP text while retaining the other result text', async () => {
    render(
      <Harness
        toolName="mcp__images__generate"
        output={{
          content: [
            { type: 'text', text: 'Generated an image' },
            { type: 'text', text: 'https://example.com/result.png?signature=abc' }
          ]
        }}
      />
    )
    expect(await screen.findByRole('img', { name: 'message.tools.sections.output' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aW1hZ2U='
    )
    expect(screen.getByText('Generated an image')).toBeInTheDocument()
    expect(screen.queryByText('https://example.com/result.png?signature=abc')).not.toBeInTheDocument()
  })

  it('renders a plain URL result as a link instead of an output table', () => {
    render(<Harness toolName="lookup" output="https://example.com/docs" />)
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toHaveAttribute(
      'href',
      'https://example.com/docs'
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('previews a large URL array inside an MCP text block without exceeding the argument limit', () => {
    const urls = Array.from({ length: 200000 }, (_, index) => `https://example.com/large-agent/${index}`)
    render(
      <Harness toolName="mcp__images__generate" output={{ content: [{ type: 'text', text: JSON.stringify(urls) }] }} />
    )
    expect(screen.getByText('Omitted: 199980')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(20)
    expect(screen.getByRole('link', { name: urls[0] })).toHaveAttribute('href', urls[0])
    expect(screen.getByRole('link', { name: urls[19] })).toHaveAttribute('href', urls[19])
    expect(screen.queryByRole('link', { name: urls[20] })).not.toBeInTheDocument()
  })

  it('bounds a large URL array before creating preview requests', () => {
    const output = Array.from({ length: 20000 }, (_, index) => `https://example.com/budget/${index}`)
    render(<Harness toolName="lookup" output={output} />)
    expect(screen.getAllByRole('link')).toHaveLength(20)
    expect(screen.getByText('Omitted: 19980')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: output[20] })).not.toBeInTheDocument()
    expect(window.api.ipcApi.request).toHaveBeenCalledTimes(20)
    expect(fetch).not.toHaveBeenCalled()
  })
})
