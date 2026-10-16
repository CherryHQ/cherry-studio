import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { UpdateAssistantSchema, type UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { DataApiDataChangeEffect, DataRequest } from '@shared/data/api/types'
import { type Assistant, AssistantSchema, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'
import { McpServerSchema } from '@shared/data/types/mcpServer'

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

// Only the unrelated model picker and agent editor branch are isolated.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))
vi.mock('../AgentEditDialog', () => ({ AgentEditDialog: () => null }))

import { ResourceEditDialogHost } from '../ResourceEditDialogHost'

const assistantId = '10000000-0000-4000-8000-000000000000'
const ids = [1, 2, 3].map((n) => `10000000-0000-4000-8000-00000000000${n}`)
const timestamp = '2026-10-12T00:00:00.000Z'
const servers = ids.map((id, n) => McpServerSchema.parse({ id, name: `MCP ${'ABC'[n]}`, isActive: true }))
const bases = ids.map((id, n) => ({
  ...KnowledgeBaseSchema.parse({
    id,
    name: `Knowledge ${'ABC'[n]}`,
    groupId: null,
    dimensions: null,
    embeddingModelId: null,
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    createdAt: timestamp,
    updatedAt: timestamp
  }),
  itemCount: 0
}))
type RelationField = 'mcpServerIds' | 'knowledgeBaseIds'
let persisted: Assistant
let patches: UpdateAssistantDto[]
let beforePatch: () => Promise<void>

function emit() {
  for (const listener of bridge.listeners) listener([{ endpoint: '/assistants/:id', entityIds: [assistantId] }])
}

async function settleAutoSave() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 750)))
}

async function openEditor(field: RelationField) {
  persisted = { ...persisted, [field]: [ids[0]] }
  render(
    <ResourceEditDialogHost
      target={{
        kind: 'assistant',
        id: assistantId,
        initialTab: field === 'mcpServerIds' ? 'tools.mcp' : 'tools.knowledge'
      }}
      onOpenChange={vi.fn()}
    />,
    { wrapper: createSWRTestWrapper().Wrapper }
  )
  if (field === 'mcpServerIds') expect(await screen.findByRole('switch', { name: 'MCP A' })).toBeChecked()
  else await screen.findByText('Knowledge A')
}

async function toggle(field: RelationField, label: 'A' | 'B' | 'C', enabled: boolean) {
  const user = userEvent.setup()
  if (field === 'mcpServerIds') {
    await user.click(screen.getByRole('switch', { name: `MCP ${label}` }))
  } else if (enabled) {
    await user.click(screen.getByRole('button', { name: 'Add knowledge base' }))
    await user.click(await screen.findByRole('option', { name: new RegExp(`Knowledge ${label}`) }))
  } else {
    // Each removal in this scenario targets the first displayed binding.
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
  }
}

async function expectLinked(field: RelationField, label: 'A' | 'B' | 'C') {
  if (field === 'mcpServerIds')
    await waitFor(() => expect(screen.getByRole('switch', { name: `MCP ${label}` })).toBeChecked())
  else await screen.findByText(`Knowledge ${label}`)
}

describe('assistant relation reconciliation through the production editor', () => {
  beforeAll(async () => {
    // JSDOM does not implement scrolling used by the real catalog command list.
    HTMLElement.prototype.scrollIntoView = () => {}
    await i18next.changeLanguage('en-us')
    dataApiService.configureRetry({ retryDelay: 1 })
  })
  afterAll(() => dataApiService.configureRetry({ retryDelay: 1000 }))
  afterEach(cleanup)
  beforeEach(() => {
    persisted = AssistantSchema.parse({
      id: assistantId,
      name: 'Original',
      prompt: '',
      emoji: '🌟',
      description: '',
      settings: { ...DEFAULT_ASSISTANT_SETTINGS },
      modelId: null,
      modelName: null,
      groupId: null,
      orderKey: 'a0',
      mcpServerIds: [],
      knowledgeBaseIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })
    patches = []
    beforePatch = async () => {}
    bridge.request.mockReset().mockImplementation(async (request: DataRequest) => {
      let data: unknown = []
      const target = `/assistants/${assistantId}`
      if (request.method === 'PATCH' && request.path === target) {
        const patch = UpdateAssistantSchema.parse(request.body)
        patches.push(patch)
        await beforePatch()
        const result = { ...persisted, ...patch, settings: { ...persisted.settings, ...patch.settings } }
        // GET order follows retained junction timestamps, independently of PATCH input order.
        persisted = {
          ...result,
          mcpServerIds: result.mcpServerIds.toSorted(),
          knowledgeBaseIds: result.knowledgeBaseIds.toSorted()
        }
        data = result
        emit()
      } else if (request.path === target) data = persisted
      else if (request.path === '/assistants') data = { items: [persisted], total: 1, page: 1 }
      else if (request.path === '/mcp-servers') data = { items: servers, total: servers.length }
      else if (request.path === '/knowledge-bases') data = { items: bases, total: bases.length }
      return { id: request.id, status: 200, data: structuredClone(data) }
    })
  })

  it.each([
    { field: 'mcpServerIds' as const, laterObservation: false },
    { field: 'knowledgeBaseIds' as const, laterObservation: false },
    { field: 'mcpServerIds' as const, laterObservation: true },
    { field: 'knowledgeBaseIds' as const, laterObservation: true }
  ])(
    'keeps the latest bindings after a retried $field write (later observation: $laterObservation)',
    async ({ field, laterObservation }) => {
      const request = bridge.request.getMockImplementation()!
      let first = true
      let started = false
      let committed = false
      let failDetail = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let releaseCommit!: () => void
      const committedGate = new Promise<void>((resolve) => {
        releaseCommit = resolve
      })
      bridge.request.mockImplementation(async (input: DataRequest) => {
        if (input.method === 'PATCH') {
          if (first) {
            first = false
            started = true
            await gate
            return {
              id: input.id,
              status: 500,
              error: DataApiErrorFactory.internal(new Error('Not committed')).toJSON()
            }
          }
          failDetail = true
          committed = true
          persisted = { ...persisted, updatedAt: '2026-10-12T00:00:02.000Z' }
        }
        if (input.method === 'GET' && input.path === `/assistants/${assistantId}` && failDetail)
          return {
            id: input.id,
            status: 500,
            error: DataApiErrorFactory.internal(new Error('Read unavailable')).toJSON()
          }
        const response = await request(input)
        if (input.method === 'PATCH' && laterObservation) await committedGate
        return response
      })
      await openEditor(field)
      await toggle(field, 'B', true)
      try {
        await waitFor(() => expect(started).toBe(true))
        persisted = { ...persisted, description: 'Remote', updatedAt: '2026-10-12T00:00:01.000Z' }
        await act(async () => emit())
        await settleAutoSave()
      } finally {
        await act(async () => release())
      }
      await waitFor(() => expect(committed).toBe(true))
      try {
        if (laterObservation) {
          failDetail = false
          persisted = { ...persisted, [field]: [...ids], updatedAt: '2026-10-12T00:00:03.000Z' }
          await act(async () => emit())
          await settleAutoSave()
        }
      } finally {
        await act(async () => releaseCommit())
      }
      await settleAutoSave()
      expect(persisted[field]).toEqual(laterObservation ? ids : [ids[0], ids[1]])
      await expectLinked(field, 'B')
      if (laterObservation) await expectLinked(field, 'C')
      failDetail = false
      persisted = { ...persisted, [field]: [...ids], updatedAt: '2026-10-12T00:00:03.000Z' }
      await act(async () => emit())
      await settleAutoSave()
      await expectLinked(field, 'C')
      expect(persisted[field]).toEqual(ids)
      expect(patches).toEqual([{ [field]: [ids[0], ids[1]] }])
    }
  )

  it.each<RelationField>(['mcpServerIds', 'knowledgeBaseIds'])(
    'accepts an external addition after canonical reordering of %s',
    async (field) => {
      await openEditor(field)
      await toggle(field, 'B', true)
      await toggle(field, 'A', false)
      await toggle(field, 'A', true)
      await settleAutoSave()
      expect(patches).toEqual([{ [field]: [ids[1], ids[0]] }])
      expect(persisted[field]).toEqual([ids[0], ids[1]])

      persisted = { ...persisted, [field]: [...ids], description: 'Remote' }
      await act(async () => emit())
      await settleAutoSave()
      expect(persisted[field]).toEqual(ids)
      await expectLinked(field, 'C')
      expect(persisted.description).toBe('Remote')
      expect(patches).toEqual([{ [field]: [ids[1], ids[0]] }])
    }
  )

  it.each<RelationField>(['mcpServerIds', 'knowledgeBaseIds'])(
    'retains a newer return to the original selection while %s saves',
    async (field) => {
      let started = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      beforePatch = async () => {
        started = true
        await gate
      }
      await openEditor(field)
      await toggle(field, 'B', true)
      await toggle(field, 'A', false)
      await toggle(field, 'A', true)
      await waitFor(() => expect(started).toBe(true))
      await toggle(field, 'B', false)
      await act(async () => release())
      await settleAutoSave()
      await expectLinked(field, 'A')
      expect(persisted[field]).toEqual([ids[0]])
      expect(patches).toEqual([{ [field]: [ids[1], ids[0]] }, { [field]: [ids[0]] }])
    }
  )
})
