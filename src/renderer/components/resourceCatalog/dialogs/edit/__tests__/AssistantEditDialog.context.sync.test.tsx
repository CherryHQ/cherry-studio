import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
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
const storedContext = {
  truncateThreshold: 4000,
  compress: { enabled: true, modelId: 'compression-model', thresholdPercent: 65 }
}

let persisted: ReturnType<typeof AssistantSchema.parse>
let patches: unknown[]

function emit() {
  for (const listener of bridge.listeners) listener([{ endpoint: '/assistants/:id', entityIds: [assistantId] }])
}

async function settleAutoSave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
  })
}

async function openEditor() {
  const user = userEvent.setup()
  render(
    <ResourceEditDialogHost
      target={{ kind: 'assistant', id: assistantId, initialTab: 'advanced' }}
      onOpenChange={vi.fn()}
    />,
    { wrapper: createSWRTestWrapper().Wrapper }
  )
  await screen.findByRole('switch', { name: 'Customize context management' })
  return user
}

describe('assistant context override reconciliation', () => {
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
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSettings: structuredClone(storedContext) },
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

  it.each([false, true])(
    'preserves the configuration when reenabling during the OFF save (compress: %s)',
    async (enabled) => {
      const expectedContext = { ...storedContext, compress: { ...storedContext.compress, enabled } }
      persisted.settings.contextSettings = expectedContext
      const request = bridge.request.getMockImplementation()!
      let started = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      bridge.request.mockImplementation(async (input: DataRequest) => {
        if (input.method === 'PATCH' && UpdateAssistantSchema.parse(input.body).settings?.contextSettings === null) {
          started = true
          await gate
        }
        return request(input)
      })
      const user = await openEditor()
      const toggle = screen.getByRole('switch', { name: 'Customize context management' })
      expect(toggle).toBeChecked()
      await user.click(toggle)
      await waitFor(() => expect(started).toBe(true))
      await user.click(toggle)
      await act(async () => release())
      await settleAutoSave()

      expect(toggle).toBeChecked()
      expect(screen.getByRole('spinbutton', { name: 'Tool-output truncation threshold (chars)' })).toHaveValue('4000')
      expect(persisted.settings.contextSettings).toEqual(expectedContext)
      expect(patches).toEqual([
        { settings: { contextSettings: null } },
        { settings: { contextSettings: expectedContext } }
      ])

      persisted = { ...persisted, settings: { ...persisted.settings, contextSettings: null } }
      await act(async () => emit())
      await settleAutoSave()
      expect(toggle).not.toBeChecked()
      expect(persisted.settings.contextSettings).toBeNull()
      expect(patches).toHaveLength(2)
    }
  )
})
