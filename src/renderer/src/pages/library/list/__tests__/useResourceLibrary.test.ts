import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourceLibrary } from '../useResourceLibrary'

const mocks = vi.hoisted(() => ({
  useAssistantList: vi.fn(),
  useAgentList: vi.fn(),
  useSkillList: vi.fn(),
  useTagList: vi.fn()
}))

vi.mock('../../adapters/assistantAdapter', () => ({
  assistantAdapter: {
    useList: mocks.useAssistantList
  }
}))

vi.mock('../../adapters/agentAdapter', () => ({
  agentAdapter: {
    useList: mocks.useAgentList
  }
}))

vi.mock('../../adapters/skillAdapter', () => ({
  skillAdapter: {
    useList: mocks.useSkillList
  }
}))

vi.mock('../../adapters/tagAdapter', () => ({
  useTagList: mocks.useTagList
}))

function listResult(data: unknown[]) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn()
  }
}

function renderResourceLibrary() {
  return renderHook(() =>
    useResourceLibrary({
      sidebarFilter: { type: 'resource', resourceType: 'assistant' },
      activeType: null,
      activeTag: null,
      search: '',
      sort: 'updatedAt'
    })
  )
}

describe('useResourceLibrary model display names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAssistantList.mockReturnValue(listResult([]))
    mocks.useAgentList.mockReturnValue(listResult([]))
    mocks.useSkillList.mockReturnValue(listResult([]))
    mocks.useTagList.mockReturnValue({
      tags: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('uses backend-resolved model names for both assistant and agent resource cards', () => {
    mocks.useAssistantList.mockReturnValue(
      listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'assistant')?.model).toBe('GPT-4o')
    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBe('Claude Sonnet 4.5')
  })

  it('omits the agent card model when the backend cannot resolve a modelName', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBeUndefined()
  })
})
