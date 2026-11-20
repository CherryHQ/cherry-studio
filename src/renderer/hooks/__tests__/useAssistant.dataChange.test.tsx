import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { assistantAdapter } from '@renderer/hooks/resourceCatalog/assistantAdapter'

import { useAssistantsApi } from '../useAssistant'

vi.unmock('@data/hooks/useDataApi')

afterEach(() => {
  vi.restoreAllMocks()
})

// Catches a searched Assistant library keeping its stale result after an Assistant is created elsewhere.
it('shows an Assistant created in another window in the searched library list', async () => {
  const assistants = [{ id: 'a1', name: 'Fox helper' }]
  vi.spyOn(mockDataApiService, 'get').mockImplementation((async (
    _path: string,
    options?: { query?: { search?: string } }
  ) => {
    const search = options?.query?.search?.toLowerCase()
    const items = search ? assistants.filter((a) => a.name.toLowerCase().includes(search)) : assistants
    return { items, total: items.length }
  }) as never)
  function Library() {
    useAssistantsApi()
    const { data } = assistantAdapter.useList({ search: 'fox' })
    return <div>{data.map((assistant) => assistant.name).join(', ') || 'none'}</div>
  }
  const { Wrapper } = createSWRTestWrapper()
  render(<Library />, { wrapper: Wrapper })
  await screen.findByText('Fox helper')

  assistants.push({ id: 'a2', name: 'Fox writer' })
  act(() => MockDataApiUtils.emitDataChange([{ endpoint: '/assistants', kind: 'membership', entityIds: ['a2'] }]))

  expect(await screen.findByText('Fox helper, Fox writer')).toBeInTheDocument()
})
