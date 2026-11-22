import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'
import type { KnowledgeChunkReviewList } from '@shared/data/types/knowledgeChunkGovernance'

import KnowledgeChunkReviewPanel from '../KnowledgeChunkReviewPanel'

vi.mock('@cherrystudio/ui', async () => ({
  ...(await vi.importActual('@cherrystudio/ui/components/primitives/button')),
  ...(await vi.importActual('@cherrystudio/ui/components/primitives/select'))
}))
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
const i18n = i18next.createInstance()
await i18n.init({
  lng: 'en-US',
  resources: { 'en-US': { translation: en } },
  keySeparator: false,
  interpolation: { escapeValue: false }
})
const baseId = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const oldId = '33333333-3333-4333-8333-333333333333'
const chunk: KnowledgeItemChunk = {
  id: 'b'.repeat(64),
  itemId,
  content: 'New original source',
  metadata: { itemId, itemType: 'note', source: 'Notes', chunkIndex: 0, tokenCount: 4 },
  governance: { sourceContentHash: 'c'.repeat(64), revision: 0, excluded: false, labels: [], status: 'review-needed' }
}
const view: KnowledgeChunkReviewList = {
  currentSourceContentHash: 'c'.repeat(64),
  records: [
    {
      id: oldId,
      unitId: 'a'.repeat(64),
      revision: 7,
      sourceContentHash: 'd'.repeat(64),
      charStart: 0,
      charEnd: 19,
      originalText: 'Old original source',
      state: { excluded: true, labels: ['private'], overrideText: 'Pending corrected text' },
      reason: 'source-changed'
    }
  ]
}
function component(item = itemId, chunks = [chunk], onChanged = vi.fn().mockResolvedValue(undefined)) {
  return (
    <I18nextProvider i18n={i18n}>
      <KnowledgeChunkReviewPanel baseId={baseId} itemId={item} chunks={chunks} onChanged={onChanged} />
    </I18nextProvider>
  )
}
const mutations = () => request.mock.calls.filter(([channel]) => channel === 'knowledge.review_chunk_governance')

// jsdom has no layout scrolling; selection and focus still use the real Radix controls.
const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} }))
afterAll(() => {
  if (oldScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', oldScroll)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
})

beforeEach(() => {
  vi.clearAllMocks()
  request.mockImplementation(async (channel: string) =>
    channel === 'knowledge.list_chunk_governance_reviews' ? structuredClone(view) : undefined
  )
})

describe('confirmed chunk review with real shared controls', () => {
  // A preview or Cancel must never remove saved decisions, including when the index is empty.
  it('previews discard with no current chunks, requires confirmation and returns keyboard focus on Cancel', async () => {
    const user = userEvent.setup()
    render(component(itemId, []))
    const discard = await screen.findByRole('button', { name: 'Discard old decisions' })
    expect(screen.getByText('Old original source')).toBeVisible()
    expect(screen.getByText('Pending corrected text')).toBeVisible()
    expect(screen.getByText('No current chunk. Discard old decisions or keep retrieval paused.')).toBeVisible()
    await user.click(discard)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    expect(mutations()).toHaveLength(0)
    expect(screen.getByText(/No Undo action is available/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(discard).toHaveFocus()
    expect(mutations()).toHaveLength(0)
    await user.click(discard)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(mutations()[0][1]).toEqual({
      baseId,
      itemId,
      governanceId: oldId,
      expectedRevision: 7,
      currentSourceContentHash: 'c'.repeat(64),
      action: { kind: 'discard' }
    })
  })

  it('shows both originals and captures only the explicitly selected replacement identity and revision', async () => {
    const user = userEvent.setup(),
      changed = vi.fn().mockResolvedValue(undefined)
    render(component(itemId, [chunk], changed))
    expect(await screen.findByRole('button', { name: 'Rebind to this chunk' })).toBeDisabled()
    screen.getByRole('combobox', { name: 'Replacement chunk' }).focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByText('New original source', { selector: 'pre' })).toBeVisible()
    expect(screen.getByText('Old original source', { selector: 'pre' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Rebind to this chunk' }))
    expect(
      screen.getByText('Move these decisions to the selected chunk. Corrections stay pending. No provider call runs.')
    ).toBeVisible()
    expect(mutations()).toHaveLength(0)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    expect(mutations()).toHaveLength(1)
    expect(mutations()[0][1]).toMatchObject({
      expectedRevision: 7,
      action: { kind: 'rebind', targetUnitId: chunk.id, expectedTargetRevision: 0 }
    })
  })

  it('does not retry a conflict and requires a fresh review selection', async () => {
    const user = userEvent.setup()
    request.mockImplementation(async (channel: string) => {
      if (channel === 'knowledge.list_chunk_governance_reviews') return structuredClone(view)
      throw new Error('Source changed; refresh and review again')
    })
    render(component())
    await user.click(await screen.findByRole('button', { name: 'Discard old decisions' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Source changed')
    expect(screen.getByRole('button', { name: 'Discard old decisions' })).toBeDisabled()
    expect(mutations()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'Discard old decisions' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(1)
  })

  it('does not let a late save refresh another source, even after switching away and back', async () => {
    const user = userEvent.setup(),
      changed = vi.fn().mockResolvedValue(undefined)
    let finish!: () => void
    request.mockImplementation(async (channel: string) => {
      if (channel === 'knowledge.list_chunk_governance_reviews') return structuredClone(view)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return undefined
    })
    const panel = render(component(itemId, [chunk], changed))
    await user.click(await screen.findByRole('button', { name: 'Discard old decisions' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    panel.rerender(component('44444444-4444-4444-8444-444444444444', [], changed))
    await screen.findByRole('button', { name: 'Discard old decisions' })
    panel.rerender(component(itemId, [chunk], changed))
    await screen.findByRole('button', { name: 'Discard old decisions' })
    await act(async () => finish())
    expect(changed).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('ignores stale list responses and offers recovery from a failed review read', async () => {
    let finish!: (value: KnowledgeChunkReviewList) => void
    request.mockImplementationOnce(
      () =>
        new Promise<KnowledgeChunkReviewList>((resolve) => {
          finish = resolve
        })
    )
    const panel = render(component())
    request.mockRejectedValueOnce(new Error('Index closed; refresh'))
    panel.rerender(component('44444444-4444-4444-8444-444444444444'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Index closed')
    await act(async () => finish(structuredClone(view)))
    expect(screen.queryByText('Old original source')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Old original source')).toBeVisible()
    expect(mutations()).toHaveLength(0)
  })
})
