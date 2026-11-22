import { mockDataApiService, MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { KnowledgeChunkHistoryPage } from '@shared/data/types/knowledgeChunkGovernance'

import { KnowledgeChunkHistory } from '../KnowledgeChunkHistory'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui/components/primitives/button'))
const i18n = i18next.createInstance()
await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en } }, keySeparator: false })
const baseId = '11111111-1111-4111-8111-111111111111',
  itemId = '22222222-2222-4222-8222-222222222222',
  unitId = 'a'.repeat(64)
const entry = (revision: number): KnowledgeChunkHistoryPage['items'][number] => ({
  revision,
  operation: 'edit',
  relatedGovernanceId: null,
  state: { excluded: true, labels: [`label-${revision}`], overrideText: 'Recorded correction' },
  createdAt: 1795219200000
})
const page: KnowledgeChunkHistoryPage = {
  binding: {
    id: '33333333-3333-4333-8333-333333333333',
    unitId,
    revision: 8,
    sourceContentHash: 'b'.repeat(64),
    originalText: 'Original evidence',
    charStart: 4,
    charEnd: 21,
    retired: false
  },
  items: [entry(8)],
  nextBeforeRevision: 8
}
const component = (item = itemId, revision = 8) => (
  <I18nextProvider i18n={i18n}>
    <KnowledgeChunkHistory baseId={baseId} itemId={item} unitId={unitId} revision={revision} />
  </I18nextProvider>
)
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeEach(() => {
  MockDataApiUtils.resetMocks()
  mockDataApiService.get.mockResolvedValue(structuredClone(page))
})

describe('read-only accepted chunk history', () => {
  // History must not load on mount or imply that a recorded correction is currently indexed.
  it('loads only on keyboard request, keeps provenance clear, replaces pages and never writes', async () => {
    const user = userEvent.setup()
    render(component())
    expect(mockDataApiService.get).not.toHaveBeenCalled()
    screen.getByRole('button', { name: 'Decision history' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Original evidence')).toBeVisible()
    expect(screen.getByText('Recorded text override, not proof of indexing')).toBeVisible()
    expect(screen.getByText(/Historical text is evidence only/)).toBeVisible()
    mockDataApiService.get.mockResolvedValueOnce({ ...page, items: [entry(3)], nextBeforeRevision: undefined })
    await user.click(screen.getByRole('button', { name: 'Older decisions' }))
    expect(await screen.findByText(/label-3/)).toBeVisible()
    expect(screen.queryByText(/label-8/)).not.toBeInTheDocument()
    expect(mockDataApiService.get).toHaveBeenLastCalledWith(
      `/knowledge-bases/${baseId}/items/${itemId}/chunks/${unitId}/history`,
      { query: { limit: 5, beforeRevision: 8 } }
    )
    expect(mockDataApiService.put).not.toHaveBeenCalled()
    expect(mockDataApiService.post).not.toHaveBeenCalled()
  })
  it('clears evidence on access failure, hides raw errors and recovers with refresh', async () => {
    const user = userEvent.setup()
    render(component())
    await user.click(screen.getByRole('button', { name: 'Decision history' }))
    await screen.findByText('Original evidence')
    mockDataApiService.get.mockRejectedValueOnce(new Error('private database path'))
    await user.click(screen.getByRole('button', { name: 'Older decisions' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument()
    expect(screen.queryByText('private database path')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Original evidence')).toBeVisible()
  })
  it('ignores late reads when closed and fetches current evidence on reopen', async () => {
    const user = userEvent.setup(),
      pending = deferred<KnowledgeChunkHistoryPage>()
    mockDataApiService.get.mockReturnValueOnce(pending.promise)
    render(component())
    const toggle = screen.getByRole('button', { name: 'Decision history' })
    await user.click(toggle)
    await user.click(toggle)
    await act(async () => pending.resolve(page))
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(await screen.findByText('Original evidence')).toBeVisible()
  })
  it('does not leak late history across a real scope switch or revision refresh', async () => {
    const user = userEvent.setup(),
      pending = deferred<KnowledgeChunkHistoryPage>()
    mockDataApiService.get.mockReturnValueOnce(pending.promise)
    const view = render(component())
    await user.click(screen.getByRole('button', { name: 'Decision history' }))
    view.rerender(component('another-item'))
    await act(async () => pending.resolve(page))
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument()
    view.rerender(component())
    await user.click(screen.getByRole('button', { name: 'Decision history' }))
    await screen.findByText('Original evidence')
    view.rerender(component(itemId, 9))
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument()
  })
  it('shows retired evidence without calling it active or offering a restore', async () => {
    mockDataApiService.get.mockResolvedValueOnce({
      ...page,
      binding: { ...page.binding!, retired: true },
      items: [{ ...entry(8), operation: 'rebind-away', relatedGovernanceId: '44444444-4444-4444-8444-444444444444' }]
    })
    const user = userEvent.setup()
    render(component())
    await user.click(screen.getByRole('button', { name: 'Decision history' }))
    expect(await screen.findByText(/This binding is retired/)).toBeVisible()
    expect(screen.getByText(/Transferred away/)).toBeVisible()
    expect(screen.getByText('Related decision: 44444444-4444-4444-8444-444444444444')).toBeVisible()
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()
  })
  it('distinguishes an untouched chunk from an invalid response', async () => {
    mockDataApiService.get.mockResolvedValueOnce({ binding: null, items: [] })
    const user = userEvent.setup()
    render(component())
    const toggle = screen.getByRole('button', { name: 'Decision history' })
    await user.click(toggle)
    expect(await screen.findByText('No accepted decisions for this chunk.')).toBeVisible()
    await user.click(toggle)
    mockDataApiService.get.mockResolvedValueOnce({ ...page, binding: { ...page.binding!, unitId: 'c'.repeat(64) } })
    await user.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument()
  })
})
