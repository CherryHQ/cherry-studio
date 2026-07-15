import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('../../shared/ArgsTable', () => ({
  ToolArgsTable: ({ title }: { title: string }) => <div data-testid="args-table">{title}</div>
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
    // The text summary still shows in the output table.
    expect(screen.getAllByTestId('args-table').length).toBeGreaterThan(0)
  })

  it('shows text only when the MCP result carries no image content', () => {
    render(
      <Harness
        toolName="mcp__cherry-tools__generate_image"
        output={{ content: [{ type: 'text', text: 'No painting model is configured.' }] }}
      />
    )
    expect(screen.queryByRole('img')).toBeNull()
  })
})
