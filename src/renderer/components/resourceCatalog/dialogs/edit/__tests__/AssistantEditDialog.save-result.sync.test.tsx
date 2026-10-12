import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { UpdateAssistantSchema } from '@shared/data/api/schemas/assistants'
import type { DataApiDataChangeEffect, DataRequest } from '@shared/data/api/types'
import { AssistantSchema, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const bridge = vi.hoisted(() => {
  const request = vi.fn()
  const listeners: Array<(effects: DataApiDataChangeEffect[]) => void> = []
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      dataApi: {
        request,
        onDataChanged: (listener: (effects: DataApiDataChangeEffect[]) => void) => listeners.push(listener)
      },
      ipcApi: { request: vi.fn(), on: () => () => {} }
    }
  })
  return { request, listeners }
})

vi.unmock('@data/DataApiService')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('@renderer/data/hooks/useDataApi')
vi.unmock('@cherrystudio/ui')

// Only the unrelated model picker and agent editor are isolated.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))
vi.mock('../AgentEditDialog', () => ({ AgentEditDialog: () => null }))

import { ResourceEditDialogHost } from '../ResourceEditDialogHost'

const assistantId = '00000000-0000-4000-8000-000000000001'
let persisted: ReturnType<typeof AssistantSchema.parse>
let patches: unknown[]
let failDetail: boolean
let failedReads: number

function ListObserver() {
  const { data } = useQuery('/assistants')
  return <output aria-label="List name">{data?.items[0]?.name}</output>
}

function emit() {
  for (const listener of bridge.listeners) listener([{ endpoint: '/assistants/:id', entityIds: [assistantId] }])
}

async function settleAutoSave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
  })
}

describe('assistant editor successful writes with failed detail reads', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en-us')
    // Exercise real retry handling without waiting for production backoff intervals.
    dataApiService.configureRetry({ retryDelay: 1 })
  })
  afterAll(() => dataApiService.configureRetry({ retryDelay: 1000 }))
  afterEach(cleanup)
  beforeEach(() => {
    persisted = AssistantSchema.parse({
      id: assistantId,
      name: 'Original',
      prompt: '',
      emoji: '🤖',
      description: '',
      settings: { ...DEFAULT_ASSISTANT_SETTINGS },
      modelId: null,
      modelName: null,
      groupId: null,
      orderKey: 'a0',
      mcpServerIds: [],
      knowledgeBaseIds: [],
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z'
    })
    patches = []
    failDetail = false
    failedReads = 0
    bridge.request.mockReset().mockImplementation(async (request: DataRequest) => {
      if (request.method === 'GET' && request.path === `/assistants/${assistantId}` && failDetail) {
        failedReads += 1
        return {
          id: request.id,
          status: 500,
          error: DataApiErrorFactory.internal(new Error('Detail unavailable')).toJSON()
        }
      }
      if (request.method === 'PATCH' && request.path === `/assistants/${assistantId}`) {
        const patch = UpdateAssistantSchema.parse(request.body)
        patches.push(patch)
        persisted = { ...persisted, ...patch, settings: { ...persisted.settings, ...patch.settings } }
        emit()
      }
      const data =
        request.path === `/assistants/${assistantId}`
          ? persisted
          : request.path === '/assistants'
            ? { items: [persisted], total: 1, page: 1 }
            : []
      return { id: request.id, status: 200, data: structuredClone(data) }
    })
  })

  it('uses the committed result after a pre-commit refresh and a retried write', async () => {
    const request = bridge.request.getMockImplementation()!
    let firstAttempt = true
    let started = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    bridge.request.mockImplementation(async (input: DataRequest) => {
      if (input.method === 'PATCH') {
        if (firstAttempt) {
          firstAttempt = false
          started = true
          await gate
          return {
            id: input.id,
            status: 500,
            error: DataApiErrorFactory.internal(new Error('Write not committed')).toJSON()
          }
        }
        failDetail = true
        persisted = { ...persisted, updatedAt: '2026-10-12T00:00:02.000Z' }
      }
      return request(input)
    })
    const user = userEvent.setup()
    render(<ResourceEditDialogHost target={{ kind: 'assistant', id: assistantId }} onOpenChange={vi.fn()} />, {
      wrapper: createSWRTestWrapper().Wrapper
    })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Local')
    try {
      await waitFor(() => expect(started).toBe(true))
      persisted = { ...persisted, description: 'Remote', updatedAt: '2026-10-12T00:00:01.000Z' }
      await act(async () => emit())
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Remote'))
    } finally {
      await act(async () => release())
    }
    await waitFor(() => expect(persisted.name).toBe('Local'))
    await settleAutoSave()
    expect(failedReads).toBeGreaterThan(0)
    expect(name).toHaveValue('Local')
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Remote')
    expect(patches).toEqual([{ name: 'Local' }])
    failDetail = false
    persisted = { ...persisted, name: 'Later', description: 'Later description', updatedAt: '2026-10-12T00:00:03.000Z' }
    await act(async () => emit())
    await settleAutoSave()
    expect(name).toHaveValue('Later')
    expect(persisted.name).toBe('Later')
    expect(patches).toEqual([{ name: 'Local' }])
  })

  it.each(['settled', 'newer-input', 'observed-external'] as const)(
    'acknowledges the PATCH result without losing %s state',
    async (scenario) => {
      const request = bridge.request.getMockImplementation()!
      let hold = true
      let started = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      bridge.request.mockImplementation(async (input: DataRequest) => {
        if (scenario === 'observed-external' && input.path === '/assistants' && patches.length > 0 && hold) {
          started = true
          await gate
        }
        const response = await request(input)
        if (scenario === 'newer-input' && input.method === 'PATCH' && patches.length === 1 && hold) {
          started = true
          await gate
        }
        return response
      })
      const user = userEvent.setup()
      render(
        <>
          <ListObserver />
          <ResourceEditDialogHost target={{ kind: 'assistant', id: assistantId }} onOpenChange={vi.fn()} />
        </>,
        { wrapper: createSWRTestWrapper().Wrapper }
      )
      await waitFor(() => expect(screen.getByLabelText('List name')).toHaveTextContent('Original'))
      const name = screen.getByRole('textbox', { name: 'Name' })
      failDetail = true
      await user.clear(name)
      await user.type(name, 'Local')
      try {
        await waitFor(() => expect(persisted.name).toBe('Local'))
        await waitFor(() => expect(failedReads).toBeGreaterThan(0))
        if (scenario !== 'settled') await waitFor(() => expect(started).toBe(true))
        if (scenario === 'newer-input') {
          await user.clear(name)
          await user.type(name, 'Original')
        }
        if (scenario === 'observed-external') {
          failDetail = false
          persisted = { ...persisted, name: 'External', description: 'Remote' }
          await act(async () => emit())
          await waitFor(() => expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Remote'))
        }
      } finally {
        hold = false
        await act(async () => release())
      }
      await settleAutoSave()
      if (scenario === 'newer-input') {
        expect(name).toHaveValue('Original')
        await waitFor(() => expect(persisted.name).toBe('Original'))
        expect(name).toHaveValue('Original')
      }
      failDetail = false
      persisted = { ...persisted, name: 'External', description: 'Remote' }
      await act(async () => emit())
      await settleAutoSave()
      expect(name).toHaveValue('External')
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Remote')
      expect(persisted.name).toBe('External')
      expect(patches).toEqual(
        scenario === 'newer-input' ? [{ name: 'Local' }, { name: 'Original' }] : [{ name: 'Local' }]
      )
    }
  )
})
