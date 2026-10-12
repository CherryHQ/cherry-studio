import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { useQuery } from '@renderer/data/hooks/useDataApi'
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

// The model picker and agent branch are unrelated to assistant form persistence.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))
vi.mock('../AgentEditDialog', () => ({ AgentEditDialog: () => null }))

import { ResourceEditDialogHost } from '../ResourceEditDialogHost'

const assistantId = '00000000-0000-4000-8000-000000000001'
let persisted: ReturnType<typeof AssistantSchema.parse>
let patches: unknown[]

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

describe('assistant editor overlapping post-save refreshes', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en-us')
  })
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
    bridge.request.mockReset().mockImplementation(async (request: DataRequest) => {
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

  it('does not turn an untouched numeric blur into input during pending refreshes', async () => {
    persisted.settings.contextSettings = { truncateThreshold: 4000, compress: { enabled: false, modelId: null } }
    const request = bridge.request.getMockImplementation()!
    let listRefreshStarted = false
    let holdList = true
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    bridge.request.mockImplementation(async (input: DataRequest) => {
      if (input.path === '/assistants' && patches.length > 0 && holdList) {
        listRefreshStarted = true
        await gate
      }
      return request(input)
    })
    const user = userEvent.setup()
    render(
      <>
        <ListObserver />
        <ResourceEditDialogHost
          target={{ kind: 'assistant', id: assistantId, initialTab: 'advanced' }}
          onOpenChange={vi.fn()}
        />
      </>,
      { wrapper: createSWRTestWrapper().Wrapper }
    )
    await screen.findByRole('switch', { name: 'Customize context management' })
    const threshold = screen.getByRole('spinbutton', { name: 'Tool-output truncation threshold (chars)' })
    await user.clear(threshold)
    await user.type(threshold, '6000')
    await user.tab()
    try {
      await waitFor(() => expect(listRefreshStarted).toBe(true))
      expect(persisted.settings.contextSettings?.truncateThreshold).toBe(6000)
      persisted.settings.contextSettings = { truncateThreshold: 7000, compress: { enabled: false, modelId: null } }
      await act(async () => emit())
      await waitFor(() => expect(threshold).toHaveValue('7000'))
      await user.click(threshold)
      await user.tab()
      persisted.settings.contextSettings = { truncateThreshold: 8000, compress: { enabled: false, modelId: null } }
      await act(async () => emit())
      await waitFor(() => expect(threshold).toHaveValue('8000'))
    } finally {
      holdList = false
      await act(async () => release())
    }
    await settleAutoSave()
    expect(persisted.settings.contextSettings?.truncateThreshold).toBe(8000)
    expect(patches).toEqual([
      { settings: { contextSettings: { truncateThreshold: 6000, compress: { enabled: false, modelId: null } } } }
    ])
  })

  it.each([
    { input: null, beforeSettlement: false },
    { input: 'Original', beforeSettlement: false },
    { input: 'Local', beforeSettlement: false },
    { input: 'External', beforeSettlement: false },
    { input: null, beforeSettlement: true },
    { input: 'Original', beforeSettlement: true },
    { input: 'Local', beforeSettlement: true },
    { input: 'External', beforeSettlement: true }
  ])(
    'acknowledges refreshes (newer input: $input, second refresh before settlement: $beforeSettlement)',
    async ({ input, beforeSettlement }) => {
      const hasRemainingInput = input !== null && input !== 'External'
      const request = bridge.request.getMockImplementation()!
      let listRefreshStarted = false
      let holdList = true
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      bridge.request.mockImplementation(async (input: DataRequest) => {
        if (input.path === '/assistants' && patches.length > 0 && holdList) {
          listRefreshStarted = true
          await gate
        }
        return request(input)
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
      const name = await screen.findByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Local')
      try {
        await waitFor(() => expect(listRefreshStarted).toBe(true))
        await waitFor(() => expect(persisted.name).toBe('Local'))
        persisted = { ...persisted, name: 'External' }
        await act(async () => emit())
        await waitFor(() => expect(name).toHaveValue('External'))
        if (input !== null) {
          await user.clear(name)
          await user.type(name, input)
        }
        if (beforeSettlement) {
          persisted = { ...persisted, name: 'Other' }
          await act(async () => emit())
          await waitFor(() => expect(name).toHaveValue(hasRemainingInput ? input : 'Other'))
        }
        if (input === 'Local') {
          await settleAutoSave()
          expect(patches).toEqual([{ name: 'Local' }])
        }
      } finally {
        holdList = false
        await act(async () => release())
      }
      await settleAutoSave()
      const expected = hasRemainingInput ? input : beforeSettlement ? 'Other' : 'External'
      await waitFor(() => expect(persisted.name).toBe(expected))
      expect(name).toHaveValue(expected)
      expect(patches).toEqual(hasRemainingInput ? [{ name: 'Local' }, { name: input }] : [{ name: 'Local' }])

      persisted = { ...persisted, name: 'Other' }
      await act(async () => emit())
      await settleAutoSave()
      expect(persisted.name).toBe('Other')
      expect(name).toHaveValue('Other')
      expect(patches).toEqual(hasRemainingInput ? [{ name: 'Local' }, { name: input }] : [{ name: 'Local' }])
    }
  )
})
