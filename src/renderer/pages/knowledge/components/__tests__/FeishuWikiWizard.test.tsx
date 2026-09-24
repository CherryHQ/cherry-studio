import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

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

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Alice' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
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
    mockRequest.mockImplementationOnce(async () => {
      throw new Error('Temporary provider failure')
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Alice' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
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
})
