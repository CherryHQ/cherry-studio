// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, cleanup, configure, getConfig, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, StrictMode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import type { ArchiveEntry } from '@shared/data/api/schemas/archives'
import type { CursorPaginationResponse } from '@shared/data/api/types'

import AllArchiveSection from '../AllArchiveSection'

vi.unmock('@data/hooks/useDataApi')
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const asyncWrapper = getConfig().asyncWrapper
const EMPTY = 'No archived items'
const entry = (name = 'Archived topic'): ArchiveEntry => ({
  id: `topics:${name}`,
  entityId: name,
  domain: 'topics',
  name,
  parentName: 'Assistant',
  deletedAt: Date.UTC(2026, 9, 28)
})
const page = (items: ArchiveEntry[] = [], nextCursor?: string): CursorPaginationResponse<ArchiveEntry> => ({
  items,
  nextCursor
})
function deferred() {
  let resolve!: (value: CursorPaginationResponse<ArchiveEntry>) => void
  const promise = new Promise<CursorPaginationResponse<ArchiveEntry>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
}
function mount() {
  const cache = new Map()
  const value = { provider: () => cache }
  function Harness({ visible = true, present = true }: { visible?: boolean; present?: boolean }) {
    return (
      <StrictMode>
        <SWRConfig value={value}>
          <Activity mode={visible ? 'visible' : 'hidden'}>
            {present && (
              <AllArchiveSection
                retentionDays={30}
                isBatchMode={false}
                isPermanentDeleting={false}
                onRequestDelete={vi.fn()}
              />
            )}
          </Activity>
        </SWRConfig>
      </StrictMode>
    )
  }
  const view = render(<Harness />)
  return {
    ...view,
    show: (present: boolean, visible = true) => view.rerender(<Harness present={present} visible={visible} />)
  }
}
function reads() {
  return vi.mocked(dataApiService.get).mock.calls.filter(([path]) => path === '/archives')
}
function writeWhileAbsent() {
  MockDataApiUtils.setCustomResponse('/archives', 'GET', page([entry()]))
  MockDataApiUtils.emitDataChange([{ endpoint: '/topics', kind: 'membership' }])
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame'
    ]
  })
  configure({
    asyncWrapper: async (callback) => {
      let result
      await act(async () => {
        result = await callback()
      })
      return result
    }
  })
  MockDataApiUtils.resetMocks()
  await i18n.changeLanguage('en-US')
  MockDataApiUtils.setCustomResponse('/archives', 'GET', page())
})
afterEach(() => {
  cleanup()
  configure({ asyncWrapper })
  vi.useRealTimers()
})

describe('All Archive entry reads', () => {
  it('starts one cold read under StrictMode without painting an empty state while loading', async () => {
    const pending = deferred()
    vi.mocked(dataApiService.get).mockReturnValue(pending.promise)
    mount()
    const initialEmpty = screen.queryByText(EMPTY) !== null
    await flush()
    expect(reads()).toHaveLength(1)
    expect(initialEmpty).toBe(false)
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument()
    await act(async () => pending.resolve(page([entry()])))
    await flush()
    expect(screen.getByText('Archived topic')).toBeVisible()
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument()
  })

  it('cancels entry work when immediately unmounted', async () => {
    const view = mount()
    view.show(false)
    await flush()
    expect(reads()).toHaveLength(0)
  })

  it('shows a failed cold read and retries into the actual archived row', async () => {
    MockDataApiUtils.setErrorResponse('/archives', 'GET', new Error('Unavailable'))
    mount()
    await flush()
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument()
    const user = userEvent.setup({ delay: null })
    MockDataApiUtils.setCustomResponse('/archives', 'GET', page([entry()]))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()
    expect(screen.getByText('Archived topic')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(reads()).toHaveLength(2)
  })

  it('re-reads on fast remount after an absent membership event and on a second activation', async () => {
    const view = mount()
    await flush()
    expect(screen.getByText(EMPTY)).toBeVisible()
    expect(reads()).toHaveLength(1)
    view.show(false)
    writeWhileAbsent()
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(2)
    expect(screen.queryByText('Archived topic')).toBeVisible()
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument()
    view.show(false)
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(3)
    expect(screen.getByText('Archived topic')).toBeVisible()
  })

  it('does not repair a missed write merely because the cleanup timer expires', async () => {
    const view = mount()
    await flush()
    view.show(false)
    writeWhileAbsent()
    // Return before cleanup; baseline stays stale even after its request marker expires.
    view.show(true)
    await flush()
    const count = reads().length
    const visible = screen.queryByText('Archived topic') !== null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(reads()).toHaveLength(count)
    expect(screen.queryByText('Archived topic') !== null).toBe(visible)
    expect(count).toBe(2)
    expect(visible).toBe(true)
  })

  it('re-reads after Activity hide/show but not an ordinary rerender or response', async () => {
    const view = mount()
    await flush()
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(1)
    view.show(true, false)
    await flush()
    writeWhileAbsent()
    view.show(true)
    await flush()
    expect(screen.queryByText('Archived topic')).toBeVisible()
    expect(reads()).toHaveLength(2)
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(2)
  })

  it('keeps the fresh result when an older unresolved activation finishes last', async () => {
    const old = deferred()
    vi.mocked(dataApiService.get).mockReturnValueOnce(old.promise)
    const view = mount()
    await flush()
    expect(reads()).toHaveLength(1)
    view.show(false)
    writeWhileAbsent()
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(2)
    expect(screen.queryByText('Archived topic')).toBeVisible()
    await act(async () => old.resolve(page([entry('Stale topic')])))
    await flush()
    expect(screen.getByText('Archived topic')).toBeVisible()
    expect(screen.queryByText('Stale topic')).not.toBeInTheDocument()
    expect(reads()).toHaveLength(2)
  })

  it('refreshes retained pages sequentially with the new cursor and preserves row order', async () => {
    let refreshed = false
    const freshHead = deferred()
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      const cursor = options?.query?.cursor
      if (!cursor) return refreshed ? freshHead.promise : page([entry('First')], 'old-cursor')
      return page([entry(refreshed ? 'Fresh second' : 'Second')])
    })
    const view = mount()
    await flush()
    const user = userEvent.setup({ delay: null })
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await flush()
    expect(screen.getByText('Second')).toBeVisible()
    const before = reads().length
    view.show(true, false)
    await flush()
    refreshed = true
    view.show(true)
    await flush()
    expect(reads()).toHaveLength(before + 1)
    expect(screen.getByText('First')).toBeVisible()
    expect(screen.getByText('Second')).toBeVisible()
    await act(async () => freshHead.resolve(page([entry('Fresh first')], 'fresh-cursor')))
    await flush()
    expect(
      reads()
        .slice(before)
        .map(([, options]) => options?.query)
    ).toEqual([{ limit: 50 }, { limit: 50, cursor: 'fresh-cursor' }])
    const first = screen.getByText('Fresh first')
    const second = screen.getByText('Fresh second')
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('refreshes once for a live notification batch and stops after unmount', async () => {
    const view = mount()
    await flush()
    MockDataApiUtils.setCustomResponse('/archives', 'GET', page([entry()]))
    MockDataApiUtils.emitDataChange([
      { endpoint: '/topics', kind: 'membership' },
      { endpoint: '/assistants', kind: 'membership' }
    ])
    await flush()
    expect(reads()).toHaveLength(2)
    expect(screen.getByText('Archived topic')).toBeVisible()
    view.show(false)
    writeWhileAbsent()
    await flush()
    expect(reads()).toHaveLength(2)
  })
})
