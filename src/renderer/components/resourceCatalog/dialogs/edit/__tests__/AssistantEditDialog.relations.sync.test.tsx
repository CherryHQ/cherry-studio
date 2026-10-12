import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
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
  })
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
