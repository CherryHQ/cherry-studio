import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ToolsSection from '../sections/ToolsSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: () => ({
    data: {
      items: [
        {
          id: 'server-a',
          name: 'Server A',
          description: '',
          baseUrl: '',
          command: '',
          isActive: true
        },
        {
          id: 'server-b',
          name: 'Server B',
          description: '',
          baseUrl: '',
          command: '',
          isActive: true
        }
      ]
    },
    isLoading: false
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  ...(() => {
    const R = require('react')
    const s =
      (omit: string[] = []) =>
      ({ children, ...p }: any) => {
        for (const k of ['direction', 'align', 'justify', 'gap', 'wrap', 'inline', 'asChild', ...omit]) delete p[k]
        return R.createElement('div', p, children)
      }
    return {
      Box: s(),
      Flex: s(),
      HStack: s(),
      VStack: s(),
      Stack: s(),
      Center: s(),
      Grid: s(['columns', 'flow']),
      PageShell: s(['scroll']),
      Container: s(['size', 'padded', 'fluid']),
      Spacer: s(),
      TruncatingRow: ({ children, leading, trailing, ...p }: any) => {
        for (const k of ['gap', 'align', 'justify', 'wrap', 'asChild']) delete p[k]
        return R.createElement('div', p, leading, children, trailing)
      }
    }
  })(),
  Alert: ({ children, message }: { children?: ReactNode; message?: ReactNode }) => (
    <div>
      {message}
      {children}
    </div>
  ),
  Button: (props: ComponentProps<'button'> & { variant?: string }) => {
    const { children, variant, ...buttonProps } = props
    void variant
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  }
}))

vi.mock('../../components/CatalogPicker', () => ({
  AddCatalogPopover: () => null,
  BoundCatalogList: ({ items }: { items: Array<{ id: string; name: string }> }) => (
    <ol>
      {items.map((item) => (
        <li key={item.id} data-testid="bound-server">
          {item.name}
        </li>
      ))}
    </ol>
  )
}))

vi.mock('../../components/McpServerAvatar', () => ({
  McpServerAvatar: () => <span />
}))

vi.mock('../../FieldHeader', () => ({
  FieldHeader: ({ label }: { label: ReactNode }) => <div>{label}</div>
}))

describe('Assistant ToolsSection', () => {
  it('renders bound MCP servers in saved id order', () => {
    render(
      <ToolsSection
        mcpMode="manual"
        mcpServerIds={['server-b', 'server-a']}
        onModeChange={vi.fn()}
        onServerIdsChange={vi.fn()}
      />
    )

    expect(screen.getAllByTestId('bound-server').map((item) => item.textContent)).toEqual(['Server B', 'Server A'])
  })
})
