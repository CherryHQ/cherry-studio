import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
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
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 405 }))))
  afterEach(() => vi.unstubAllGlobals())
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
      'https://example.com/result.png?signature=abc'
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
})
