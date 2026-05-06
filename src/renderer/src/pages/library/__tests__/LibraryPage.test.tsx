import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE_ORDER } from '../constants'
import LibraryPage from '../LibraryPage'

const { allResourcesMock, navigateMock, refetchSpy, routeSearchMock } = vi.hoisted(() => ({
  allResourcesMock: [] as any[],
  navigateMock: vi.fn(),
  refetchSpy: vi.fn(),
  routeSearchMock: vi.fn(() => ({}))
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
    create: (Component: ComponentType<Record<string, unknown>>) => Component
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => routeSearchMock()
}))

vi.mock('../adapters/assistantAdapter', () => ({
  useAssistantMutations: () => ({
    duplicateAssistant: vi.fn()
  })
}))

vi.mock('../adapters/tagAdapter', () => ({
  useEnsureTags: () => ({
    ensureTags: vi.fn()
  }),
  useTagList: () => ({
    tags: []
  })
}))

vi.mock('../list/useResourceLibrary', () => ({
  useResourceLibrary: () => ({
    resources: [],
    allResources: allResourcesMock,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    typeCounts: {
      assistant: 0,
      agent: 0,
      skill: 0
    },
    refetch: refetchSpy
  })
}))

vi.mock('../list/LibrarySidebar', () => ({
  LibrarySidebar: () => <div data-testid="library-sidebar" />
}))

vi.mock('../list/DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: () => null
}))

vi.mock('../list/ImportAssistantDialog', () => ({
  ImportAssistantDialog: () => null
}))

vi.mock('../list/ImportSkillDialog', () => ({
  ImportSkillDialog: () => null
}))

vi.mock('../list/ResourceGrid', () => ({
  ResourceGrid: ({
    activeResourceType,
    onCreate
  }: {
    activeResourceType: 'assistant' | 'agent' | 'skill'
    onCreate: (type: 'assistant' | 'agent' | 'skill') => void
  }) => (
    <div data-testid="resource-grid" data-resource-type={activeResourceType}>
      <button type="button" onClick={() => onCreate('assistant')}>
        create assistant
      </button>
      <button type="button" onClick={() => onCreate('agent')}>
        create agent
      </button>
    </div>
  )
}))

vi.mock('../editor/assistant/AssistantConfigPage', () => ({
  default: ({
    assistant,
    onCreated
  }: {
    assistant?: { id: string }
    onCreated?: (created: { id: string }) => void
  }) => (
    <div data-testid={assistant ? 'assistant-edit-page' : 'assistant-create-page'}>
      <button type="button" onClick={() => onCreated?.({ id: 'assistant-created' })}>
        finish assistant create
      </button>
    </div>
  )
}))

vi.mock('../editor/agent/AgentConfigPage', () => ({
  default: ({ agent, onCreated }: { agent?: { id: string }; onCreated?: (created: { id: string }) => void }) => (
    <div data-testid={agent ? 'agent-edit-page' : 'agent-create-page'}>
      <button type="button" onClick={() => onCreated?.({ id: 'agent-created' })}>
        finish agent create
      </button>
    </div>
  )
}))

describe('LibraryPage create flow', () => {
  beforeEach(() => {
    allResourcesMock.length = 0
    navigateMock.mockReset()
    refetchSpy.mockReset()
    routeSearchMock.mockReset()
    routeSearchMock.mockReturnValue({})
  })

  it('uses the first sidebar resource type as the initial grid filter', () => {
    render(<LibraryPage />)

    expect(screen.getByTestId('resource-grid')).toHaveAttribute('data-resource-type', RESOURCE_TYPE_ORDER[0])
  })

  it('returns to the list and refetches after assistant creation succeeds', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create assistant' }))
    expect(screen.getByTestId('assistant-create-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish assistant create' }))

    await waitFor(() => {
      expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('assistant-edit-page')).not.toBeInTheDocument()
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns to the list and refetches after agent creation succeeds', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create agent' }))
    expect(screen.getByTestId('agent-create-page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish agent create' }))

    await waitFor(() => {
      expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('agent-edit-page')).not.toBeInTheDocument()
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('opens the assistant create page from route search', () => {
    routeSearchMock.mockReturnValue({ resourceType: 'assistant', action: 'create' })

    render(<LibraryPage />)

    expect(screen.getByTestId('assistant-create-page')).toBeInTheDocument()
  })

  it('opens the agent editor from route search after resources load', () => {
    allResourcesMock.push({
      id: 'agent-from-selector',
      type: 'agent',
      name: 'Selector Agent',
      description: '',
      avatar: '',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'agent-from-selector' }
    })
    routeSearchMock.mockReturnValue({ resourceType: 'agent', action: 'edit', id: 'agent-from-selector' })

    render(<LibraryPage />)

    expect(screen.getByTestId('agent-edit-page')).toBeInTheDocument()
  })
})
