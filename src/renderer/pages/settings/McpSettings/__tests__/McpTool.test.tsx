import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { render, screen } from '@testing-library/react'
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

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      React.createElement(tag, props, children)

  const DataTable = ({ columns = [], data = [], rowKey, emptyText }: any) => {
    if (!data.length) {
      return React.createElement('div', null, emptyText)
    }

    return React.createElement(
      'table',
      { 'data-testid': 'data-table' },
      React.createElement(
        'tbody',
        null,
        data.map((row: any) =>
          React.createElement(
            'tr',
            { key: row[rowKey] ?? row.id },
            columns.map((column: any) => {
              const width = column.meta?.width
              const maxWidth = column.meta?.maxWidth
              const style = {
                ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : null),
                ...(maxWidth !== undefined
                  ? { maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }
                  : null)
              }

              return React.createElement(
                'td',
                {
                  key: column.id ?? column.accessorKey,
                  'data-column-id': column.id ?? column.accessorKey,
                  className: column.meta?.className,
                  style
                },
                column.cell
                  ? column.cell({
                      row: { original: row },
                      getValue: () => (column.accessorKey ? row[column.accessorKey] : undefined)
                    })
                  : column.accessorKey
                    ? row[column.accessorKey]
                    : null
              )
            })
          )
        )
      )
    )
  }

  const Tooltip = ({ children, content, title, fullWidthTrigger = false, className, classNames }: any) => {
    const wrapperClassName = [
      'relative z-10',
      fullWidthTrigger ? 'block w-full min-w-0 max-w-full' : 'inline-block',
      className,
      classNames?.placeholder
    ]
      .filter(Boolean)
      .join(' ')

    return React.createElement(
      'div',
      {
        className: wrapperClassName,
        'data-slot': 'tooltip-trigger',
        ...(content || title ? { 'data-title': content || title } : {})
      },
      children
    )
  }

  return {
    Badge: passthrough('span'),
    ColFlex: passthrough('div'),
    DataTable,
    Flex: passthrough('div'),
    InfoTooltip: ({ content }: any) => React.createElement('span', { 'data-title': content }),
    RequiredMark: () => React.createElement('span', null, '*'),
    Switch: ({ checked, disabled, onCheckedChange, ...props }: any) =>
      React.createElement('input', {
        ...props,
        checked: Boolean(checked),
        disabled,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked),
        type: 'checkbox'
      }),
    Tooltip
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

  it('keeps tooltip-wrapped descriptions inside constrained table cells', () => {
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

    const description = screen.getByText(toolDescription)
    expect(description).toHaveClass('line-clamp-1', 'block', 'w-full', 'min-w-0')

    const trigger = description.closest('[data-slot="tooltip-trigger"]')
    expect(trigger).not.toBeNull()
    expect(trigger).toHaveClass('block', 'w-full', 'min-w-0', 'max-w-full')
    expect(trigger).not.toHaveClass('inline-block')

    const cell = trigger?.closest('td')
    expect(cell).not.toBeNull()
    expect(cell).toHaveStyle({ width: '400px', maxWidth: '400px' })
  })
})
