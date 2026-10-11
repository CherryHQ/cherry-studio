import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { UpdateAssistantSchema } from '@shared/data/api/schemas/assistants'
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

let persisted: Assistant
let patches: unknown[]

function emit() {
  for (const listener of bridge.listeners) listener([{ endpoint: '/assistants/:id', entityIds: ['target'] }])
}

async function settleAutoSave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 750))
  })
}

async function openEditor() {
  render(<ResourceEditDialogHost target={{ kind: 'assistant', id: 'target' }} onOpenChange={vi.fn()} />, {
    wrapper: createSWRTestWrapper().Wrapper
  })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Original'))
}

describe('assistant editor notification reconciliation', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en-us')
  })
  afterEach(cleanup)
  beforeEach(() => {
    persisted = {
      id: 'target',
      name: 'Original',
      prompt: '',
      emoji: '',
      description: '',
      settings: { ...DEFAULT_ASSISTANT_SETTINGS },
      modelId: null,
      modelName: null,
      groupId: null,
      orderKey: 'a0',
      mcpServerIds: [],
      knowledgeBaseIds: [],
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z'
    }
    patches = []
    bridge.request.mockReset().mockImplementation(async (request: DataRequest) => {
      if (request.method === 'PATCH' && request.path === '/assistants/target') {
        const patch = UpdateAssistantSchema.parse(request.body)
        patches.push(patch)
        persisted = { ...persisted, ...patch, settings: { ...persisted.settings, ...patch.settings } }
        emit()
      }
      const data =
        request.path === '/assistants/target'
          ? persisted
          : request.path === '/assistants'
            ? { items: [persisted], total: 1, page: 1 }
            : []
      return { id: request.id, status: 200, data: structuredClone(data) }
    })
  })

  it('refreshes an untouched production editor without reverting the external edit', async () => {
    await openEditor()
    persisted = { ...persisted, name: 'External rename', description: 'External description' }
    await act(async () => emit())
    await settleAutoSave()

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('External rename')
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('External description')
    expect(persisted.name).toBe('External rename')
    expect(patches).toEqual([])
  })

  it('retains a pending local edit and only persists that edit after an external refresh', async () => {
    const user = userEvent.setup()
    await openEditor()
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Local draft')
    persisted = { ...persisted, name: 'External rename' }
    await act(async () => emit())
    await settleAutoSave()

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('External rename')
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Local draft')
    expect(persisted).toMatchObject({ name: 'External rename', description: 'Local draft' })
    expect(patches).toEqual([{ description: 'Local draft' }])

    persisted = { ...persisted, description: 'Later external edit' }
    await act(async () => emit())
    await settleAutoSave()
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Later external edit')
    expect(patches).toEqual([{ description: 'Local draft' }])
  })
})
