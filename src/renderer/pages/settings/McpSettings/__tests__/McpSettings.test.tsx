import { popup } from '@renderer/services/popup'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => ({ request: vi.fn() }))

const server = {
  id: 'srv-1',
  name: 'Test Server',
  type: 'stdio' as const,
  isActive: false,
  command: 'node',
  args: [],
  env: {},
  headers: {},
  disabledTools: [],
  disabledAutoApproveTools: [],
  tags: []
}

const updateMcpServer = vi.fn(async () => {})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => requestMock.request(route, input),
    on: () => () => {}
  }
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServer: () => ({ server, isLoading: false, updateMcpServer, deleteMcpServer: vi.fn() })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled', lastError: undefined })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ serverId: 'srv-1' }),
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

vi.mock('@renderer/utils/error', () => ({
  formatMcpError: (error: { message?: string }) => error?.message ?? 'error'
}))

vi.mock('@renderer/utils/style', () => ({ cn: (...c: string[]) => c.filter(Boolean).join(' ') }))

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    reset: vi.fn(),
    watch: () => undefined,
    trigger: vi.fn(async () => true),
    getValues: () => ({ isActive: false })
  })
}))

vi.mock('@hookform/resolvers/zod', () => ({ zodResolver: () => () => ({ values: {}, errors: {} }) }))

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span />,
  SaveIcon: () => <span />
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({}))

vi.mock('@cherrystudio/ui', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    Alert: Passthrough,
    Badge: Passthrough,
    Button: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Flex: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Form: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SegmentedControl: Passthrough,
    Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>
        switch
      </button>
    ),
    Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: () => <div data-testid="search-bar" />
}))

vi.mock('@renderer/components/icons/DeleteIcon', () => ({
  default: () => <span />
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingDivider: () => <hr />,
  SettingTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  McpLogo: () => <span />
}))

vi.mock('../McpDescription', () => ({ default: () => <div /> }))
vi.mock('../McpPrompt', () => ({ default: () => <div /> }))
vi.mock('../McpResource', () => ({ default: () => <div /> }))
vi.mock('../McpTool', () => ({ default: () => <div /> }))

vi.mock('../McpServerFields', async () => {
  const { z } = await import('zod')
  return {
    buildMcpSchema: () => z.object({}),
    MCP_FORM_DEFAULT_VALUES: {},
    McpEndpointField: () => null,
    McpFormGrid: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    McpIdentityFields: () => null,
    McpRuntimeFields: () => null,
    McpTransportFields: () => null,
    toMcpServerFields: () => ({}),
    useMcpRegistryState: () => ({ syncFromServer: () => {} })
  }
})

vi.mock('../useMcpServerTrust', () => ({
  useMcpServerTrust: () => ({ ensureServerTrusted: async (s: unknown) => s })
}))

vi.mock('../utils', () => ({
  toUpdateMcpServerDto: (s: unknown) => s
}))

import McpSettings from '../McpSettings'

const CAPABILITY_ROUTES = [
  'mcp.server.refresh_tools',
  'mcp.server.list_prompts',
  'mcp.server.list_resources',
  'mcp.server.get_version'
] as const

function makeDeferred<T>(value: T) {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve: () => resolve(value), reject }
}

describe('McpSettings onToggleActive capability reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    requestMock.request.mockReset()
  })

  it('starts all four capability requests concurrently before any resolves', async () => {
    const deferreds = CAPABILITY_ROUTES.map(() => makeDeferred(undefined))
    const routeCalls: string[] = []
    requestMock.request.mockImplementation((route: string) => {
      routeCalls.push(route)
      const idx = CAPABILITY_ROUTES.indexOf(route as (typeof CAPABILITY_ROUTES)[number])
      return deferreds[idx].promise
    })

    render(<McpSettings />)

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    // updateMcpServer({ body: { isActive: true } }) resolves first; then the four
    // capability requests are dispatched together via Promise.allSettled.
    await waitFor(() => expect(requestMock.request).toHaveBeenCalledTimes(4))

    // None of the deferreds have resolved yet, but every route was already called.
    expect(routeCalls).toEqual(expect.arrayContaining([...CAPABILITY_ROUTES]))
    expect(popup.error).not.toHaveBeenCalled()

    await act(async () => {
      deferreds.forEach((d) => d.resolve())
    })

    await waitFor(() => expect(popup.error).not.toHaveBeenCalled())
  })

  it('shows at most one start error and keeps cleanup correct when a read rejects', async () => {
    const deferreds = CAPABILITY_ROUTES.map(() => makeDeferred(undefined))
    requestMock.request.mockImplementation((route: string) => {
      const idx = CAPABILITY_ROUTES.indexOf(route as (typeof CAPABILITY_ROUTES)[number])
      return deferreds[idx].promise
    })

    render(<McpSettings />)

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    await waitFor(() => expect(requestMock.request).toHaveBeenCalledTimes(4))

    await act(async () => {
      // Resolve three, reject one (refresh_tools).
      deferreds[1].resolve()
      deferreds[2].resolve()
      deferreds[3].resolve()
      deferreds[0].reject(new Error('boom'))
    })

    await waitFor(() => expect(popup.error).toHaveBeenCalledTimes(1))
    expect(popup.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'settings.mcp.startError' }))
  })
})
