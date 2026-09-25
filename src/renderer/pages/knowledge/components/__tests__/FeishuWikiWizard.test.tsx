import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import FeishuWikiWizard from '../FeishuWikiWizard'

const mockRequest = vi.fn()
const mockInvalidate = vi.fn(async () => undefined)
const mockQuery = vi.fn()
const mockOpenExternal = vi.fn(async () => undefined)

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mockRequest(...args) } }))
vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: () => mockQuery(),
  useInvalidateCache: () => mockInvalidate
}))

const connection = {
  id: '0199c87a-1200-7000-8000-000000000001',
  displayName: 'Alice',
  authorizationStatus: 'connected'
}
const url = 'https://acme.feishu.cn/wiki/wikcnNode'
const preview = {
  resolution: {
    account: { displayName: 'Alice' },
    tenantId: 'tenant-1',
    scope: { kind: 'node', nodeId: 'wikcnNode' },
    selected: { title: 'Team handbook', documentKind: 'document' }
  },
  visibleNodeCount: 4,
  supportedDocxCount: 3,
  unsupportedOrSkippedCount: 1,
  warnings: []
}
const createdSource = { id: '0199c87a-1200-7000-8000-000000000002' }
const space = { spaceId: 'space-1', name: 'Project Wiki', description: 'Shared project documents' }
const spacePreview = {
  space,
  visibleNodeCount: 8,
  supportedDocxCount: 5,
  unsupportedOrSkippedCount: 3,
  embeddingCostExact: false,
  warnings: []
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Alice' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Paste a link' }))
  await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Add Feishu Wiki' })
  await screen.findByRole('textbox', { name: 'Source name' })
}

describe('FeishuWikiWizard', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })
  beforeEach(() => {
    mockRequest.mockReset()
    mockInvalidate.mockClear()
    mockQuery.mockReset()
    mockOpenExternal.mockClear()
    mockQuery.mockReturnValue({ data: [connection], isLoading: false, error: undefined, refetch: vi.fn() })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.space.preview') return spacePreview
      if (route === 'knowledge.feishu.scope.preview') return preview
      if (route === 'knowledge.external_source.create') return createdSource
      return undefined
    })
    Object.assign(window.api, { shell: { openExternal: mockOpenExternal } })
  })

  it('previews the chosen scope and creates a manual source without waiting for sync', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<FeishuWikiWizard open baseId="00000000-0000-4000-8000-000000000001" onOpenChange={onOpenChange} />)

    await reachReview(user)
    expect(screen.getByText('3 supported documents')).toBeInTheDocument()
    expect(screen.getByText('1 unsupported or skipped')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Source name' })).toHaveValue('Team handbook')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: '00000000-0000-4000-8000-000000000001',
      connectionId: connection.id,
      url,
      name: 'Team handbook'
    })
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.schedule.update', expect.anything())
    expect(mockInvalidate).toHaveBeenCalledWith('/knowledge-bases/:id/external-knowledge-sources')
  })

  it('keeps the URL step available when preview fails, then permits a retry', async () => {
    const user = userEvent.setup()
    let previewAttempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview' && previewAttempts++ === 0) {
        throw new Error('Temporary provider failure')
      }
      if (route === 'knowledge.feishu.scope.preview') return preview
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Paste a link' }))
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not preview this Feishu Wiki URL')
    expect(screen.getByRole('textbox', { name: 'Feishu Wiki URL' })).toHaveValue(url)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('textbox', { name: 'Source name' })).toHaveValue('Team handbook')
  })

  it('closes after creation even when daily scheduling fails and explains the manual fallback', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview') return preview
      if (route === 'knowledge.external_source.create') return createdSource
      if (route === 'knowledge.external_source.schedule.update') throw new Error('Schedule failed')
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

    await reachReview(user)
    await user.click(screen.getByRole('button', { name: 'Daily' }))
    await user.clear(screen.getByLabelText('Daily sync time'))
    await user.type(screen.getByLabelText('Daily sync time'), '10:30')
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('source was created')))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
      sourceId: createdSource.id,
      policy: expect.objectContaining({ kind: 'daily', time: '10:30' })
    })
    expect(mockRequest.mock.calls.filter(([route]) => route === 'knowledge.external_source.create')).toHaveLength(1)
  })

  it('shows connection loading and recovery before account selection', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockQuery.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Offline'), refetch })
    const { rerender } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load Feishu connections')
    await user.click(screen.getByRole('button', { name: 'Retry loading' }))
    expect(refetch).toHaveBeenCalledOnce()

    mockQuery.mockReturnValue({ data: undefined, isLoading: true, error: undefined, refetch })
    rerender(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('cancels pending Feishu authorization when the wizard closes', async () => {
    const user = userEvent.setup()
    mockQuery.mockReturnValue({ data: [], isLoading: false, error: undefined, refetch: vi.fn() })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin') {
        return {
          authorizationSessionId: '55555555-5555-4555-8555-555555555555',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://accounts.feishu.cn/verify',
          connection: { id: 'pending-1' }
        }
      }
      if (route === 'knowledge.feishu.authorization.complete') return await new Promise(() => undefined)
      return undefined
    })
    const onOpenChange = vi.fn()
    const { unmount } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'Connect with my app' }))
    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    expect(await screen.findByText('Verification code: ABCD-EFGH')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    unmount()

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.cancel', {
        authorizationSessionId: '55555555-5555-4555-8555-555555555555'
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockOpenExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/verify')
  })

  it('selects an available whole Wiki space and creates it without inventing a URL', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space, space] }
      if (route === 'knowledge.feishu.space.preview') return spacePreview
      if (route === 'knowledge.external_source.create') return createdSource
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findAllByRole('button', { name: /Project Wiki/ })).toHaveLength(1)
    await user.click(await screen.findByRole('button', { name: /Project Wiki/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('textbox', { name: 'Source name' })).toHaveValue('Project Wiki')
    expect(screen.getByText('5 supported documents')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create source' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.space.preview', {
      connectionId: connection.id,
      spaceId: space.spaceId
    })
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: 'base-1',
      connectionId: connection.id,
      spaceId: space.spaceId,
      name: 'Project Wiki'
    })
  })

  it('loads another page and lets the user choose a space from it', async () => {
    const user = userEvent.setup()
    const laterSpace = { spaceId: 'space-2', name: 'Research Wiki', description: null }
    mockRequest.mockImplementation(async (route: string, input?: { pageToken?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') {
        return input?.pageToken ? { spaces: [space, laterSpace] } : { spaces: [space], nextPageToken: 'page-2' }
      }
      if (route === 'knowledge.feishu.space.preview') return { ...spacePreview, space: laterSpace }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Load more spaces' }))
    expect(screen.getAllByRole('button', { name: /Project Wiki/ })).toHaveLength(1)
    await user.click(await screen.findByRole('button', { name: 'Research Wiki' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('textbox', { name: 'Source name' })).toHaveValue('Research Wiki')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Research Wiki' })).toHaveAttribute('aria-pressed', 'true')
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.spaces.list', {
      connectionId: connection.id,
      pageToken: 'page-2'
    })
  })

  it('keeps pagination available when an accessible-space page is empty', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string, input?: { pageToken?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') {
        return input?.pageToken ? { spaces: [space] } : { spaces: [], nextPageToken: 'page-2' }
      }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('button', { name: 'Load more spaces' })
    expect(screen.queryByText(/No Wiki spaces are available/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more spaces' }))

    expect(await screen.findByRole('button', { name: /Project Wiki/ })).toBeInTheDocument()
  })

  it('ignores a late space page from a previously selected account', async () => {
    const user = userEvent.setup()
    const otherConnection = { ...connection, id: '0199c87a-1200-7000-8000-000000000003', displayName: 'Bob' }
    const otherSpace = { spaceId: 'space-2', name: 'Bob Wiki', description: null }
    let resolveAlice: (page: { spaces: (typeof space)[] }) => void = () => undefined
    mockQuery.mockReturnValue({
      data: [connection, otherConnection],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockRequest.mockImplementation(async (route: string, input?: { connectionId?: string }) => {
      if (route !== 'knowledge.feishu.spaces.list') return undefined
      if (input?.connectionId === connection.id) {
        return await new Promise((resolve) => {
          resolveAlice = resolve
        })
      }
      return { spaces: [otherSpace] }
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Bob' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('button', { name: 'Bob Wiki' })).toBeInTheDocument()

    await act(async () => resolveAlice({ spaces: [space] }))
    expect(screen.queryByRole('button', { name: /Project Wiki/ })).not.toBeInTheDocument()
  })

  it('explains missing space-list permission and preserves the URL path', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') {
        throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Permission missing')
      }
      if (route === 'knowledge.feishu.scope.preview') return preview
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wiki:space:retrieve')
    await user.click(screen.getByRole('button', { name: 'Paste a link' }))
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('textbox', { name: 'Source name' })).toHaveValue('Team handbook')
  })

  it('reauthorizes space discovery only after the user requests it and reloads spaces', async () => {
    const user = userEvent.setup()
    let listAttempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list' && listAttempts++ === 0) {
        throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Permission missing')
      }
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.connection.reconnect') {
        return {
          authorizationSessionId: '55555555-5555-4555-8555-555555555555',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://accounts.feishu.cn/verify'
        }
      }
      if (route === 'knowledge.feishu.authorization.complete') return connection
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wiki:space:retrieve')
    expect(screen.getByText(/pauses sync for sources using this connection/)).toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.connection.reconnect', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Authorize space listing' }))

    expect(await screen.findByRole('button', { name: /Project Wiki/ })).toBeInTheDocument()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.connection.reconnect', {
      connectionId: connection.id,
      includeSpaceDiscovery: true
    })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/verify')
  })

  it('retries a failed space list and recovers the selection', async () => {
    const user = userEvent.setup()
    let listAttempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list' && listAttempts++ === 0) throw new Error('Offline')
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load available Wiki spaces')
    await user.click(screen.getByRole('button', { name: 'Retry spaces' }))

    expect(await screen.findByRole('button', { name: /Project Wiki/ })).toBeInTheDocument()
  })

  it('requests optional space-discovery permission only when connecting a custom app with opt-in', async () => {
    const user = userEvent.setup()
    mockQuery.mockReturnValue({ data: [], isLoading: false, error: undefined, refetch: vi.fn() })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin') return await new Promise(() => undefined)
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Connect with my app' }))
    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    await user.click(screen.getByRole('checkbox', { name: /Wiki space discovery/ }))
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.begin', {
        kind: 'custom-app',
        appId: 'cli_test',
        appSecret: 'secret',
        includeSpaceDiscovery: true
      })
    )
  })
})
