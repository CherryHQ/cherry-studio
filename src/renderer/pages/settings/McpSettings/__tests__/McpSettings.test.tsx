// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpPrompt, McpResource } from '@shared/types/mcp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpSettings from '../McpSettings'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  server: undefined as McpServer | undefined,
  request: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  popupError: vi.fn(),
  ensureServerTrusted: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    SegmentedControl: ({ options = [] }: { options?: Array<{ value: string; label: ReactNode }> }) => (
      <div>
        {options.map((option) => (
          <span key={option.value}>{option.label}</span>
        ))}
      </div>
    ),
    Switch: ({
      checked,
      loading,
      onCheckedChange
    }: {
      checked?: boolean
      loading?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-loading={loading ? 'true' : 'false'}
        onClick={() => onCheckedChange?.(!checked)}
      />
    ),
    Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'connected' })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServer: () => ({
    server: mocks.server,
    isLoading: false,
    updateMcpServer: mocks.updateMcpServer,
    deleteMcpServer: mocks.deleteMcpServer
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.request(...args),
    on: () => vi.fn()
  }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: { confirm: vi.fn(), error: mocks.popupError }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ serverId: '00000000-0000-4000-8000-000000000001' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

vi.mock('../McpPrompt', () => ({ default: () => null }))
vi.mock('../McpResource', () => ({ default: () => null }))
vi.mock('../McpTool', () => ({ default: () => null }))

vi.mock('../useMcpServerTrust', () => ({
  useMcpServerTrust: () => ({ ensureServerTrusted: mocks.ensureServerTrusted })
}))

const serverId = '00000000-0000-4000-8000-000000000001'
const prompt: McpPrompt = {
  id: 'prompt-1',
  name: 'Prompt one',
  serverId,
  serverName: 'Test server'
}
const resource: McpResource = {
  uri: 'file:///resource.txt',
  name: 'Resource one',
  serverId,
  serverName: 'Test server'
}

describe('McpSettings capability refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    mocks.server = {
      id: serverId,
      name: 'Test server',
      type: 'inMemory',
      isActive: false,
      isTrusted: true
    }
    mocks.ensureServerTrusted.mockImplementation(async () => mocks.server)
    mocks.updateMcpServer.mockResolvedValue(undefined)
  })

  it('starts all capability requests concurrently and applies successful values', async () => {
    const toolsRequest = createDeferred<void>()
    const promptsRequest = createDeferred<McpPrompt[]>()
    const resourcesRequest = createDeferred<McpResource[]>()
    const versionRequest = createDeferred<string>()
    const firstRequests = new Map<string, Promise<unknown>>([
      ['mcp.server.refresh_tools', toolsRequest.promise],
      ['mcp.server.list_prompts', promptsRequest.promise],
      ['mcp.server.list_resources', resourcesRequest.promise],
      ['mcp.server.get_version', versionRequest.promise]
    ])

    mocks.request.mockImplementation((channel: string) => firstRequests.get(channel))

    render(<McpSettings />)
    fireEvent.click(screen.getAllByRole('switch')[0])

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledTimes(4)
    })
    expect(mocks.request.mock.calls.map(([channel]) => channel)).toEqual([
      'mcp.server.refresh_tools',
      'mcp.server.list_prompts',
      'mcp.server.list_resources',
      'mcp.server.get_version'
    ])
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('data-loading', 'true')

    await act(async () => {
      mocks.server = { ...mocks.server!, isActive: true }
      toolsRequest.resolve()
      promptsRequest.resolve([prompt])
      resourcesRequest.resolve([resource])
      versionRequest.resolve('1.2.3')
      await Promise.all([
        toolsRequest.promise,
        promptsRequest.promise,
        resourcesRequest.promise,
        versionRequest.promise
      ])
    })

    await waitFor(() => {
      expect(screen.getByText('1.2.3')).toBeInTheDocument()
      expect(screen.getByText('settings.mcp.tabs.prompts (1)')).toBeInTheDocument()
      expect(screen.getByText('settings.mcp.tabs.resources (1)')).toBeInTheDocument()
      expect(screen.getAllByRole('switch')[0]).toHaveAttribute('data-loading', 'false')
    })
    expect(mocks.popupError).not.toHaveBeenCalled()
  })

  it('keeps loading until all requests settle and reports one start error', async () => {
    const toolsRequest = createDeferred<void>()
    const promptsRequest = createDeferred<McpPrompt[]>()
    const resourcesRequest = createDeferred<McpResource[]>()
    const versionRequest = createDeferred<string>()
    const firstRequests = new Map<string, Promise<unknown>>([
      ['mcp.server.refresh_tools', toolsRequest.promise],
      ['mcp.server.list_prompts', promptsRequest.promise],
      ['mcp.server.list_resources', resourcesRequest.promise],
      ['mcp.server.get_version', versionRequest.promise]
    ])

    mocks.request.mockImplementation((channel: string) => firstRequests.get(channel))

    render(<McpSettings />)
    fireEvent.click(screen.getAllByRole('switch')[0])

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledTimes(4)
    })

    await act(async () => {
      promptsRequest.reject(new Error('prompts failed'))
      await promptsRequest.promise.catch(() => undefined)
    })

    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('data-loading', 'true')
    expect(mocks.popupError).not.toHaveBeenCalled()

    await act(async () => {
      mocks.server = { ...mocks.server!, isActive: true }
      toolsRequest.reject(new Error('tools failed'))
      resourcesRequest.resolve([resource])
      versionRequest.resolve('1.2.3')
      await Promise.allSettled([
        toolsRequest.promise,
        promptsRequest.promise,
        resourcesRequest.promise,
        versionRequest.promise
      ])
    })

    await waitFor(() => {
      expect(mocks.popupError).toHaveBeenCalledTimes(1)
      expect(screen.getByText('1.2.3')).toBeInTheDocument()
      expect(screen.getByText('settings.mcp.tabs.resources (1)')).toBeInTheDocument()
      expect(screen.getAllByRole('switch')[0]).toHaveAttribute('data-loading', 'false')
    })
    expect(mocks.popupError).toHaveBeenCalledWith({
      title: 'settings.mcp.startError',
      content: expect.any(String),
      centered: true
    })
  })
})
