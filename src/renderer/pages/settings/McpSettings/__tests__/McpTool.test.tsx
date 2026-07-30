import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import McpToolsSection from '../McpTool'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useIsToolAutoApproved: () => false
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  McpLogo: (props: any) => <svg data-testid="mcp-logo" {...props} />
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cherrystudio/ui')>()
  return {
    ...actual,
    Markdown: ({ children, className, ...props }: any) =>
      React.createElement('div', { ...props, className: ['markdown', className].filter(Boolean).join(' ') }, children)
  }
})

describe('McpToolsSection', () => {
  const toolDescription = 'A long tool description that should remain clamped inside the tooltip trigger wrapper.'

  const tool: McpTool = {
    id: 'server__very_long_tool_name',
    name: 'Very long MCP tool name that should stay truncated in the table',
    description: toolDescription,
    type: 'mcp',
    serverId: '123e4567-e89b-42d3-a456-426614174000',
    serverName: 'Demo MCP Server',
    inputSchema: { type: 'object' }
  }

  const server: McpServer = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    name: 'Demo MCP Server',
    isActive: true
  }

  it('shows a shortened description preview without duplicating the full text in a tooltip', () => {
    render(
      <McpToolsSection
        tools={[tool]}
        server={server}
        searchText=""
        onToggleTool={vi.fn()}
        onToggleAutoApprove={vi.fn()}
      />
    )

    expect(screen.getByText(tool.name)).toHaveClass('truncate')

    const description = screen.getByText(`${toolDescription.slice(0, 40).trimEnd()}…`)
    expect(description).toHaveClass('line-clamp-1', 'block', 'w-full', 'max-w-72')
    expect(description.closest('[data-slot="tooltip-trigger"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))

    expect(screen.getByText(toolDescription)).toHaveClass('markdown')
  })

  it('removes the tools table surface backgrounds', () => {
    const { container } = render(
      <McpToolsSection
        tools={[tool]}
        server={server}
        searchText=""
        onToggleTool={vi.fn()}
        onToggleAutoApprove={vi.fn()}
      />
    )

    const table = container.querySelector('[data-slot="data-table-shell"]')
    expect(table).toHaveClass('bg-transparent')
    expect(table.className).toContain('[&_[data-slot=table-cell]]:bg-transparent')
    expect(table.className).toContain('[&_[data-slot=table-head]]:bg-transparent')
    expect(table.className).toContain('[&_[data-slot=table-header]]:bg-transparent')
    expect(table.className).toContain('[&_[data-slot=table-header]_[data-slot=table-row]]:bg-transparent')
    expect(screen.getByText(tool.name).closest('tr')).toHaveClass('bg-transparent')
  })

  it('renders the description and nested schema properties in the expanded row', () => {
    const nestedTool: McpTool = {
      ...tool,
      description: 'Supports Markdown content.',
      inputSchema: {
        type: 'object',
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            description: 'Configuration options',
            properties: {
              retries: {
                type: 'number',
                description: 'Retry count',
                enum: [1, true]
              }
            }
          },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  description: 'Entry label'
                }
              }
            }
          }
        }
      }
    }

    render(
      <McpToolsSection
        tools={[nestedTool]}
        server={server}
        searchText=""
        onToggleTool={vi.fn()}
        onToggleAutoApprove={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))

    expect(screen.getByRole('heading', { name: 'common.description' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'settings.mcp.tools.inputSchema.label' })).toBeInTheDocument()
    expect(screen.getByText(nestedTool.description!, { selector: '.markdown' })).toBeInTheDocument()

    const configName = screen.getByText('config')
    const configNode = configName.closest('[data-schema-property="config"]')
    expect(configNode).toContainElement(screen.getByText('retries'))
    expect(configNode).toHaveTextContent('settings.mcp.tools.inputSchema.enum.allowedValues1true')

    const arrayNode = screen.getByText('entries').closest('[data-schema-property="entries"]')
    expect(arrayNode).toContainElement(screen.getByText('label'))
  })

  it('keeps description expandable without showing an empty schema section', () => {
    render(
      <McpToolsSection
        tools={[{ ...tool, inputSchema: { type: 'object', properties: {} } }]}
        server={server}
        searchText=""
        onToggleTool={vi.fn()}
        onToggleAutoApprove={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))

    expect(screen.getByRole('heading', { name: 'common.description' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'settings.mcp.tools.inputSchema.label' })).not.toBeInTheDocument()
  })
})
