import type { McpServer } from '@shared/data/types/mcpServer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as McpServerFieldsModule from '../McpServerFields'
import McpSettings from '../McpSettings'

const mockUseMcpServer = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())
const updateMcpServer = vi.hoisted(() => vi.fn())
const deleteMcpServer = vi.hoisted(() => vi.fn())

let currentServer: McpServer

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServer: mockUseMcpServer,
  useIsToolAutoApproved: () => false
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled', lastCheckedAt: 0 })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: vi.fn(() => () => {}),
    request: vi.fn()
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ serverId: currentServer.id })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock('@cherrystudio/ui', async () => {
  const { FormProvider } = await import('react-hook-form')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
      React.createElement(tag, props, children)

  return {
    Alert: passthrough('div'),
    Badge: passthrough('span'),
    Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean }) => {
      void loading
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Divider: passthrough('hr'),
    Flex: passthrough('div'),
    Form: FormProvider,
    SegmentedControl: ({
      onValueChange,
      options,
      value,
      ...props
    }: {
      onValueChange?: (value: string) => void
      options?: unknown[]
      value?: string
    }) => {
      void onValueChange
      void options
      void value
      return <div {...props} />
    },
    Switch: ({
      checked,
      loading,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean
      loading?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => {
      void loading
      return (
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onCheckedChange?.(event.target.checked)}
          {...props}
        />
      )
    },
    Tabs: ({
      onValueChange,
      value,
      variant,
      ...props
    }: {
      children?: ReactNode
      onValueChange?: (value: string) => void
      value?: string
      variant?: string
    }) => {
      void onValueChange
      void value
      void variant
      return <div {...props} />
    },
    TabsContent: passthrough('div')
  }
})

vi.mock('../McpServerFields', async (importOriginal) => {
  const actual = await importOriginal<typeof McpServerFieldsModule>()

  return {
    ...actual,
    McpEndpointField: () => null,
    McpFormGrid: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    McpIdentityFields: ({ form }: { form: { register: (name: 'name') => Record<string, unknown> } }) => (
      <label>
        Server name
        <input aria-label="Server name" {...form.register('name')} />
      </label>
    ),
    McpRuntimeFields: () => null,
    McpTransportFields: () => null
  }
})

describe('McpSettings', () => {
  beforeEach(() => {
    currentServer = {
      id: 'server-a',
      name: 'Server A',
      type: 'stdio',
      command: 'server-a',
      isActive: false
    }
    mockUseMcpServer.mockImplementation(() => ({
      server: currentServer,
      isLoading: false,
      updateMcpServer,
      deleteMcpServer
    }))
  })

  it('preserves edits for the same server ID and loads defaults for a different server ID', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<McpSettings />)
    const nameInput = screen.getByRole('textbox', { name: 'Server name' })

    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved server name')

    currentServer = { ...currentServer, name: 'Refetched Server A' }
    rerender(<McpSettings />)

    expect(screen.getByRole('textbox', { name: 'Server name' })).toHaveValue('Unsaved server name')

    currentServer = {
      id: 'server-b',
      name: 'Server B',
      type: 'stdio',
      command: 'server-b',
      isActive: false
    }
    rerender(<McpSettings />)

    expect(screen.getByRole('textbox', { name: 'Server name' })).toHaveValue('Server B')
  })
})
