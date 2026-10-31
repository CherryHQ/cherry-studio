import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { createSWRTestWrapper } from '../../data/hooks/__tests__/testUtils'

vi.unmock('@data/hooks/useDataApi')

import { assistantAdapter } from '../resourceCatalog/assistantAdapter'
import { useAssistantsApi } from '../useAssistant'

const existingAssistant: Assistant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Existing assistant',
  orderKey: 'a0',
  prompt: '',
  emoji: '💬',
  description: '',
  settings: { ...DEFAULT_ASSISTANT_SETTINGS },
  modelId: null,
  modelName: null,
  groupId: null,
  mcpServerIds: [],
  knowledgeBaseIds: [],
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z'
}
const officialAssistant: Assistant = {
  ...existingAssistant,
  id: '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1',
  name: 'Claude',
  orderKey: 'a1'
}

function setAssistants(items: Assistant[]) {
  MockDataApiUtils.setCustomResponse('/assistants', 'GET', { items, total: items.length })
}

describe.each([
  { name: 'assistant lists', useList: () => useAssistantsApi().assistants },
  { name: 'assistant catalogs', useList: () => assistantAdapter.useList().data }
])('$name across window caches', ({ useList }) => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    setAssistants([existingAssistant])
  })

  it('shows assistants created in another window without remounting', async () => {
    const firstWindow = renderHook(useList, { wrapper: createSWRTestWrapper().Wrapper })
    const secondWindow = renderHook(useList, { wrapper: createSWRTestWrapper().Wrapper })
    await waitFor(() => {
      expect(firstWindow.result.current.map(({ name }) => name)).toEqual(['Existing assistant'])
      expect(secondWindow.result.current.map(({ name }) => name)).toEqual(['Existing assistant'])
    })

    setAssistants([existingAssistant, officialAssistant])
    act(() => MockDataApiUtils.emitDataChange([{ endpoint: '/assistants', kind: 'membership' }]))

    await waitFor(() => {
      expect(firstWindow.result.current.map(({ name }) => name)).toEqual(['Existing assistant', 'Claude'])
      expect(secondWindow.result.current.map(({ name }) => name)).toEqual(['Existing assistant', 'Claude'])
    })
  })

  it('shows assistant edits from another window without remounting', async () => {
    const { result } = renderHook(useList, { wrapper: createSWRTestWrapper().Wrapper })
    await waitFor(() => expect(result.current[0]?.name).toBe('Existing assistant'))

    setAssistants([{ ...existingAssistant, name: 'Renamed assistant' }])
    act(() => MockDataApiUtils.emitDataChange([{ endpoint: '/assistants', kind: 'projection' }]))

    await waitFor(() => expect(result.current[0]?.name).toBe('Renamed assistant'))
  })
})
