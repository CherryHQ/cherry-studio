import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ASSISTANT_DATA_CHANGE_DIMENSIONS } from '@shared/data/api/schemas/assistants'
import type { DataApiDataChangeEffect, DataRequest } from '@shared/data/api/types'
import type { Assistant } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const bridge = vi.hoisted(() => {
  const request = vi.fn()
  const listeners: Array<(effects: DataApiDataChangeEffect[]) => void> = []
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dataApi: {
        request,
        onDataChanged: (listener: (effects: DataApiDataChangeEffect[]) => void) => listeners.push(listener)
      }
    }
  })
  return { request, listeners }
})

vi.unmock('@data/DataApiService')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('@renderer/data/hooks/useDataApi')

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'

import { assistantAdapter } from '../resourceCatalog/assistantAdapter'
import { useAssistantApiById, useAssistantsApi } from '../useAssistant'

let assistants: Assistant[]
function assistant(id: string, name: string): Assistant {
  return {
    id,
    name,
    prompt: '',
    emoji: '😀',
    description: '',
    settings: { ...DEFAULT_ASSISTANT_SETTINGS },
    modelId: null,
    modelName: null,
    groupId: null,
    orderKey: id,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z'
  }
}
function emit(effects: DataApiDataChangeEffect[]) {
  for (const listener of bridge.listeners) listener(effects)
}
function useReceiver() {
  return { list: useAssistantsApi(), detail: useAssistantApiById('target') }
}

describe('assistant read-model convergence', () => {
  beforeEach(() => {
    assistants = [assistant('target', 'Original')]
    bridge.request.mockReset().mockImplementation(async (request: DataRequest) => {
      if (request.path === '/assistants') {
        const items = request.params?.search
          ? assistants.filter((item) => item.name.includes(String(request.params?.search)))
          : assistants
        return { id: request.id, status: 200, data: structuredClone({ items, total: items.length, page: 1 }) }
      }
      const found = assistants.find((item) => request.path === `/assistants/${item.id}`)
      return found
        ? { id: request.id, status: 200, data: structuredClone(found) }
        : { id: request.id, status: 404, error: DataApiErrorFactory.notFound('Assistant', 'target').toJSON() }
    })
  })

  it('updates independent list and detail caches after external creation, editing and ordering', async () => {
    const receivers = [
      renderHook(useReceiver, { wrapper: createSWRTestWrapper().Wrapper }),
      renderHook(useReceiver, { wrapper: createSWRTestWrapper().Wrapper })
    ]
    for (const receiver of receivers)
      await waitFor(() => expect(receiver.result.current.detail.assistant?.name).toBe('Original'))
    assistants = [assistant('added', 'Added'), assistant('target', 'Renamed')]
    await act(async () =>
      emit([
        { endpoint: '/assistants', kind: 'membership', entityIds: ['added'] },
        { endpoint: '/assistants/:id', entityIds: ['target'] }
      ])
    )
    for (const receiver of receivers)
      await waitFor(() => {
        expect(receiver.result.current.list.assistants.map((item) => item.name)).toEqual(['Added', 'Renamed'])
        expect(receiver.result.current.detail.assistant?.name).toBe('Renamed')
      })
    assistants.reverse()
    await act(async () =>
      emit([
        {
          endpoint: '/assistants',
          kind: 'order',
          dimension: ASSISTANT_DATA_CHANGE_DIMENSIONS.order.orderKey,
          entityIds: ['added']
        }
      ])
    )
    for (const receiver of receivers)
      await waitFor(() =>
        expect(receiver.result.current.list.assistants.map((item) => item.id)).toEqual(['target', 'added'])
      )
  })

  it('stops exposing a deleted assistant and recovers it after restoration', async () => {
    const receiver = renderHook(useReceiver, { wrapper: createSWRTestWrapper().Wrapper })
    await waitFor(() => expect(receiver.result.current.detail.assistant?.name).toBe('Original'))
    assistants = []
    await act(async () =>
      emit([
        { endpoint: '/assistants', kind: 'membership' },
        { endpoint: '/assistants/:id', entityIds: ['target'] }
      ])
    )
    await waitFor(() => {
      expect(receiver.result.current.list.assistants).toEqual([])
      expect(receiver.result.current.detail.error).toBeDefined()
      expect(receiver.result.current.detail.assistant).toBeUndefined()
    })
    assistants = [assistant('target', 'Restored')]
    await act(async () =>
      emit([
        { endpoint: '/assistants', kind: 'membership' },
        { endpoint: '/assistants/:id', routeParams: { id: 'target' } }
      ])
    )
    await waitFor(() => expect(receiver.result.current.detail.assistant?.name).toBe('Restored'))
  })

  it('ignores unrelated detail effects and disabled list subscriptions', async () => {
    const detail = renderHook(() => useAssistantApiById('target'), { wrapper: createSWRTestWrapper().Wrapper })
    const disabled = renderHook(() => useAssistantsApi({ enabled: false }), { wrapper: createSWRTestWrapper().Wrapper })
    await waitFor(() => expect(detail.result.current.assistant?.name).toBe('Original'))
    assistants = [assistant('target', 'Renamed')]
    await act(async () =>
      emit([
        { endpoint: '/assistants/:id', entityIds: ['other'] },
        { endpoint: '/assistants/:id', routeParams: { id: 'other' } },
        { endpoint: '/assistants', kind: 'projection' }
      ])
    )
    expect(detail.result.current.assistant?.name).toBe('Original')
    expect(disabled.result.current.hasLoaded).toBe(false)
    await act(async () => emit([{ endpoint: '/assistants/:id', entityIds: ['target'] }]))
    await waitFor(() => expect(detail.result.current.assistant?.name).toBe('Renamed'))
  })

  it('reconciles filtered catalog membership when an external edit matches its search', async () => {
    const catalog = renderHook(() => assistantAdapter.useList({ search: 'Renamed' }), {
      wrapper: createSWRTestWrapper().Wrapper
    })
    await waitFor(() => expect(catalog.result.current.isLoading).toBe(false))
    expect(catalog.result.current.data).toEqual([])
    assistants = [assistant('target', 'Renamed')]
    await act(async () =>
      emit([
        {
          endpoint: '/assistants',
          kind: 'membership',
          dimension: ASSISTANT_DATA_CHANGE_DIMENSIONS.membership.search,
          entityIds: ['target']
        }
      ])
    )
    await waitFor(() => expect(catalog.result.current.data.map((item) => item.name)).toEqual(['Renamed']))
  })
})
