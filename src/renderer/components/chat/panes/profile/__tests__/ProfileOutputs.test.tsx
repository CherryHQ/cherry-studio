import { mockUseQuery, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import type { ArtifactEntity, ArtifactKind, ArtifactList } from '@shared/data/api/schemas/artifacts'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'

import { AgentProfilePane } from '../AgentProfilePane'
import { AssistantProfilePane } from '../AssistantProfilePane'
import { renderInRightPane, serveQueries } from './profilePaneTestUtils'

// The settings' model pill wraps the real selector, which loads providers and models this test does not serve.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

// Wednesday, 11 November 2026, 12:00 local time; en-US weeks start on Sunday the 8th.
const NOW = new Date(2026, 10, 11, 12, 0)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()

const agent = { id: 'agent-1', type: 'claude-code', name: 'Code Reviewer', configuration: {} } as unknown as AgentEntity
const assistant = {
  id: 'assistant-1',
  name: 'Writing Assistant',
  emoji: '✍️',
  knowledgeBaseIds: [],
  settings: { enableBrowser: true }
} as unknown as Assistant

const output = (patch: Partial<ArtifactEntity> & Pick<ArtifactEntity, 'id' | 'title' | 'kind'>): ArtifactEntity => ({
  sourceId: 'session-1',
  sourceName: 'Daily review',
  reportedAt: at(11, 9, 41),
  ...patch
})

const REPORT = output({ id: 'a-1', title: 'PR review report', kind: 'page', path: '/ws/review.html' })
const SHOT = output({
  id: 'a-2',
  title: 'diff.png',
  kind: 'media',
  path: '/ws/diff.png',
  size: 2048,
  reportedAt: at(9, 16)
})
const NOTES = output({
  id: 'a-3',
  title: 'notes.txt',
  kind: 'file',
  path: '/ws/notes.txt',
  size: 4096,
  reportedAt: at(3, 10)
})

function serveOutputs(route: string, items: ArtifactEntity[]) {
  const counts = { all: items.length, page: 0, media: 0, file: 0 }
  for (const item of items) counts[item.kind] += 1
  serveQueries({
    '/agents/:agentId': () => agent,
    '/assistants/:id': () => assistant,
    [route]: ({ query }): ArtifactList => {
      const kind = query?.kind as ArtifactKind | undefined
      return { items: kind ? items.filter((item) => item.kind === kind) : items, counts }
    }
  })
}

/** Answers IpcApi: the file metadata check reports the listed output ids as gone. */
function serveIpc({ missingIds = [] }: { missingIds?: string[] }, routes: Record<string, unknown> = {}) {
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route in routes) return { ok: true, data: routes[route] }
    if (route !== 'file.batch_get_metadata') return { ok: true, data: undefined }
    const { items } = input as { items: { key: string }[] }
    const data = Object.fromEntries(items.map(({ key }) => [key, missingIds.includes(key) ? null : { kind: 'file' }]))
    return { ok: true, data }
  })
}

function openOutputsTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Outputs' }))
}

describe('Profile Outputs tab', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    await i18n.changeLanguage('en-US')
    serveIpc({})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the Activity tab first and the Agent outputs grouped by Today, This week and Earlier', () => {
    serveOutputs('/agents/:agentId/artifacts', [REPORT, SHOT, NOTES])
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)

    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument()
    openOutputsTab()
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument()

    const today = screen.getByRole('region', { name: 'Today' })
    expect(within(today).getByText('PR review report')).toBeInTheDocument()
    expect(within(today).getByText('Page · from “Daily review”')).toBeInTheDocument()
    expect(within(today).getByText('09:41 AM')).toBeInTheDocument()
    const week = screen.getByRole('region', { name: 'This week' })
    expect(within(week).getByText('diff.png')).toBeInTheDocument()
    expect(within(week).getByText('PNG · 2 KB')).toBeInTheDocument()
    expect(within(week).getByText('Mon')).toBeInTheDocument()
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(earlier).getByText('notes.txt')).toBeInTheDocument()
    expect(within(earlier).getByText('Nov 3')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })

  it('opens an Agent output by its path', () => {
    serveOutputs('/agents/:agentId/artifacts', [REPORT])
    const onOpenOutput = vi.fn()
    renderInRightPane(<AgentProfilePane agentId={agent.id} onOpenOutput={onOpenOutput} />)
    openOutputsTab()

    fireEvent.click(screen.getByRole('button', { name: /PR review report/ }))

    expect(onOpenOutput).toHaveBeenCalledWith('/ws/review.html')
  })

  it('filters by kind and counts the outputs of that kind', () => {
    serveOutputs('/agents/:agentId/artifacts', [REPORT, SHOT, NOTES])
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)
    openOutputsTab()

    fireEvent.click(screen.getByRole('button', { name: 'Media' }))

    expect(screen.getByRole('button', { name: 'Media' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('diff.png')).toBeInTheDocument()
    expect(screen.queryByText('PR review report')).not.toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })

  it('shows an output whose file is gone as unavailable', async () => {
    serveIpc({ missingIds: [NOTES.id] })
    serveOutputs('/agents/:agentId/artifacts', [REPORT, NOTES])
    renderInRightPane(<AgentProfilePane agentId={agent.id} onOpenOutput={vi.fn()} />)
    openOutputsTab()

    const row = await screen.findByRole('button', { name: /notes\.txt.*Unavailable/ })
    expect(row).toBeDisabled()
    expect(screen.getByRole('button', { name: /PR review report/ })).toBeEnabled()
  })

  it('says what will show up when the Agent has no outputs yet', () => {
    serveOutputs('/agents/:agentId/artifacts', [])
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)
    openOutputsTab()

    expect(screen.getByText('No outputs yet')).toBeInTheDocument()
  })

  it('offers a retry instead of a blank tab when the outputs fail to load', () => {
    serveOutputs('/agents/:agentId/artifacts', [])
    const refetch = vi.fn().mockResolvedValue(undefined)
    const served = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) =>
      path === '/agents/:agentId/artifacts'
        ? { ...served(path, options), data: undefined, error: new Error('offline'), refetch }
        : served(path, options)
    )
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)
    openOutputsTab()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('previews an image the Assistant generated', async () => {
    const image = output({
      id: 'img-1',
      title: 'cover.png',
      kind: 'media',
      fileEntryId: '019606a0-0000-7000-8000-000000000001',
      sourceId: 'topic-1',
      sourceName: 'Launch post'
    })
    serveOutputs('/assistants/:id/artifacts', [image])
    serveIpc({}, { 'file.batch_get_physical_paths': { [image.fileEntryId!]: '/data/files/cover.png' } })
    const show = vi.spyOn(ImagePreviewService, 'show').mockResolvedValue()
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)
    openOutputsTab()

    fireEvent.click(screen.getByRole('button', { name: /cover\.png/ }))

    await waitFor(() => expect(show).toHaveBeenCalledWith('file:///data/files/cover.png'))
  })
})
