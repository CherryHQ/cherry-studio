import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { assistantAdapter } from '@renderer/hooks/resourceCatalog/assistantAdapter'

import { useAssistantApiById, useAssistantsApi } from '../useAssistant'

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

it('refreshes reply language in a window that did not save the Assistant', async () => {
  let assistant = { id: 'a1', settings: { replyLanguage: { mode: 'custom', language: 'English' } } }
  vi.spyOn(mockDataApiService, 'get').mockImplementation((async () => assistant) as never)
  function Profile() {
    const { assistant: current } = useAssistantApiById('a1')
    const language = current?.settings.replyLanguage
    return <div>{language?.mode === 'custom' ? language.language : 'none'}</div>
  }
  const { Wrapper } = createSWRTestWrapper()
  render(<Profile />, { wrapper: Wrapper })
  await screen.findByText('English')

  assistant = { ...assistant, settings: { replyLanguage: { mode: 'custom', language: 'Deutsch' } } }
  act(() => MockDataApiUtils.emitDataChange([{ endpoint: '/assistants/:id', entityIds: ['a1'] }]))

  expect(await screen.findByText('Deutsch')).toBeInTheDocument()
})
