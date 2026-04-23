import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryPage from '../LibraryPage'

const refetchSpy = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>
  }
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
    allResources: [],
    allTagsFromBackend: [],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    pendingBackend: false,
    pendingBackendTypes: [],
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

vi.mock('../list/PendingBackendNotice', () => ({
  default: () => <div data-testid="pending-backend-notice" />
}))

vi.mock('../list/DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: () => null
}))

vi.mock('../list/ImportAssistantDialog', () => ({
  ImportAssistantDialog: () => null
}))

vi.mock('../list/ResourceGrid', () => ({
  ResourceGrid: ({ onCreate }: { onCreate: (type: 'assistant' | 'agent') => void }) => (
    <div data-testid="resource-grid">
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
    refetchSpy.mockReset()
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
})
